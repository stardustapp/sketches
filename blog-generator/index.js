const Future = require('fibers/future');
const {markdown} = require('markdown');
const Mustache = require('mustache');
const moment = require('moment');
const {basename} = require('path');

const {StartEnvClient, StartClient} = require('../nodejs-domain-client');
Future.task(() => {

  const startTime = new Date();
  console.log('Connecting to profile servers...');
  profile = StartEnvClient('blog').wait();
  hosting = StartClient('gke.danopia.net', 'root', process.env.STARDUST_SECRET, 'blog').wait();

  console.log('Loading blog configuration...');
  const config = profile.loadDataStructure('/config/blog', 3).wait();
  const siteTitle = config.siteTitle || 'New Blog';
  const siteSubtitle = config.siteSubtitle || 'Content goes here';
  const sections = config.sections || {};

  // load all the layout HTML files into a Map
  const layouts = new Map;
  Object.keys(config.layouts).forEach(fileName =>
    layouts.set(basename(fileName, '.html'),
      config.layouts[fileName].load().wait()));

  console.log('Loading pages and posts...');

  function renderInnerHtml(content) {
    if (content.html) {
      return content.html.load().wait();
    } else if (content.markdown) {
      return markdown.toHTML(content.markdown.load().wait());
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

  posts.forEach(p => {
    const publishedAt = moment(p.raw.publishedAt);
    if (p.raw.publishedAt && publishedAt.isValid()) {
      p.publishDate = publishedAt.format('LL [at] LT');
      p.path = `posts/${publishedAt.format('YYYY')}/${p.path}`;
    } else {
      p.path = `posts/drafts/${p.path}`;
    }
  });

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

    return Mustache.render(layouts.get('default'), {
      siteTitle, siteSubtitle,
      pages, posts, photos,
      innerHtml, baseHref,
    }).replace(/&#x2F;/g, '/')
      .replace(/&#x3D;/g, '=');
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

  htmlFiles.push({
    path: '/index.html',
    body: renderPage({
      posts, pages, photos,
    }, 'home'),
  });

  console.log('Uploading', htmlFiles.length, 'HTML files to web hosting...');
  htmlFiles.forEach(({path, body}) => {
    hosting.callApi('putFile', '/domain/public/web'+path, body, 'text/html; charset=utf-8').wait();
  });

  const assetKeys = Object.keys(config.assets);
  console.log('Uploading', assetKeys.length, 'site assets...');
  assetKeys.forEach(asset => {
    const body = config.assets[asset].load().wait();
    hosting.callApi('putFile', '/domain/public/web'+'/'+asset, body, 'text/css; charset=utf-8').wait(); // TODO: copy source MIME
  });

  const endTime = new Date();
  const elapsedSecs = Math.round((endTime - startTime) / 1000);
  console.log('Blog published in', elapsedSecs, 'seconds :)');
  process.exit(0);
}).detach();
