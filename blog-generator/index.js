const Future = require('fibers/future');
const {markdown} = require('markdown');
const Mustache = require('mustache');
const moment = require('moment');
const {basename} = require('path');

const {StartEnvClient, StartClient} = require('../nodejs-domain-client');
Future.task(() => {

  const startTime = new Date();
  console.log('Connecting to profile servers...');
  const profileFuture = StartEnvClient('blog');
  const profile = profileFuture.wait();
  const hostingFuture = StartClient('gke.danopia.net', 'root', process.env.STARDUST_SECRET, 'blog');
  const hosting = hostingFuture.wait();

  console.log('Loading blog configuration...');
  const config = profile.loadDataStructure('/config/blog', 3).wait();

  const siteTitle = config.siteTitle || 'New Blog';
  const siteSubtitle = config.siteSubtitle || 'Content goes here';
  const sections = config.sections || {};

  // load all the layout HTML files into a Map
  const layouts = new Map;
  Object.keys(config.layouts).forEach(fileName =>
    layouts.set(basename(fileName, '.html'),
      config.layouts[fileName].load().wait().toString('utf-8')));

  console.log('Loading pages and posts...');

  function renderInnerHtml(content) {
    if (content.html) {
      return content.html.load().wait().toString('utf-8');
    } else if (content.markdown) {
      return markdown.toHTML(content.markdown.load().wait().toString('utf-8'));
    }
    throw new Error("No innerHtml for content");
  }

  function loadContentNodes(path) {
    return profile.listChildNames(path).wait().map(slug => {
      const data = profile.loadDataStructure(path+'/'+slug, 2).wait();
      return {
        path: `${slug}.html`,
        title: data.title || slug,
        section: sections[data.section],
        innerHtml: renderInnerHtml(data),
        raw: data,
      };
    }).sort((a, b) => {
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return a.publishedAt.localeCompare(b.publishedAt);
    });
  }
  const pages = loadContentNodes('/data/blog/pages');
  const posts = loadContentNodes('/data/blog/posts');

  // TODO: don't require photos/ to exist
  const photosPath = '/data/blog/photos';
  const photos = profile.listChildNames(photosPath).wait().map(slug => {
    const struct = profile.loadDataStructure(photosPath+'/'+slug, 2).wait();
    return struct;
  });

  const outdatedCutoff = moment.utc().subtract(5, 'years');
  posts.forEach(p => {
    const publishedAt = moment.utc(p.raw.publishedAt);
    if (p.raw.publishedAt && publishedAt.isValid()) {
      p.publishDate = publishedAt.format('LL [at] LT');
      p.publishedAt = p.raw.publishedAt;
      p.publishedMoment = publishedAt;
      p.isOutdated = publishedAt < outdatedCutoff;
      p.path = `posts/${publishedAt.format('YYYY')}/${p.path}`;
    } else {
      p.path = `posts/drafts/${p.path}`;
    }
  });
  posts.sort(function (a, b) {
    return (b.publishedAt||'').localeCompare(a.publishedAt||'');
  });
  const publishedPosts = posts.filter(x => x.publishDate);

  console.log('Generating blog files...');

  // helper to pass a data object though one layout, then the site layout
  // special page? don't pass a layout, pass html as data.innerHtml instead
  function renderPage(data, layout) {
    var {innerHtml, baseHref} = data;
    if (layouts.has(layout)) {
      innerHtml = Mustache.render(layouts.get(layout), data);
    }
    if (!innerHtml) throw new Error("No innerHtml for content");

    if (!layouts.has('default')) throw new Error(
      `Layout 'default' not found`);

    const pageBody = Mustache.render(layouts.get('default'), {
      siteTitle, siteSubtitle,
      pages, posts, photos,
      innerHtml, baseHref,
    }).replace(/&#x2F;/g, '/')
      .replace(/&#x3D;/g, '=');
    return Buffer.from(pageBody, 'utf-8');
  }

  function reversePath(path) {
    if (path.includes('/')) {
      return path.split('/').slice(1).map(x => '..').join('/');
    } else {
      return '.';
    }
  }

  const htmlFiles = [];
  function renderContentNodes(list, layout) {
    list.forEach(content => {
      content.baseHref = reversePath(content.path);
      htmlFiles.push({
        path: '/'+content.path,
        body: renderPage(content, layout),
      });
    });
  }
  renderContentNodes(pages, 'page');
  renderContentNodes(posts, 'post');

  const nowM = moment.utc();
  htmlFiles.push({
    path: '/index.html',
    body: renderPage({
      pages, photos,
      recentPosts: publishedPosts
        .slice(0, 5)
        .filter(x => x.publishedMoment.diff(nowM, 'years') > -1),
    }, 'home'),
  });

  const newestYear = publishedPosts[0].publishedMoment.year();
  const oldestYear = publishedPosts.slice(-1)[0].publishedMoment.year();
  const postTimes = [];
  for (let year = newestYear; year >= oldestYear; year--) {
    for (let month = 11; month >= 0; month--) {
      const posts = publishedPosts.filter(x =>
        x.publishedMoment.year() === year &&
        x.publishedMoment.month() === month);
      if (posts.length === 0) continue;

      const timeStr = posts[0].publishedMoment.format('MMMM YYYY');
      postTimes.push({ year, month, timeStr, posts });
    }
  }

  htmlFiles.push({
    path: '/posts/archive.html',
    body: renderPage({
      baseHref: '..',
      postTimes,
    }, 'archive'),
  });

  console.log('Uploading', htmlFiles.length, 'HTML files to web hosting...');
  htmlFiles.forEach(({path, body}) => {
    hosting.callApi('putBlob', '/domain/public/web'+path, body, 'text/html; charset=utf-8').wait();
  });

  const assetKeys = Object.keys(config.assets);
  console.log('Uploading', assetKeys.length, 'site assets...');
  assetKeys.forEach(asset => {
    const body = config.assets[asset].load().wait();
    hosting.callApi('putBlob', '/domain/public/web'+'/'+asset, body, body.mime).wait();
  });

  const endTime = new Date();
  const elapsedSecs = Math.round((endTime - startTime) / 1000);
  console.log('Blog published in', elapsedSecs, 'seconds :)');
  process.exit(0);
}).detach();
