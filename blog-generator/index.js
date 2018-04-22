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
  hosting = StartClient('devmode.cloud', 'public', '', 'blog').wait();

  console.log('Loading blog configuration...');
  const config = profile.loadDataStructure('/config/blog', 3).wait();
  const siteTitle = config.siteTitle || 'New Blog';
  const siteSubtitle = config.siteSubtitle || 'Content goes here';

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
        innerHtml: renderInnerHtml(data),
        raw: data,
      };
    });
  }
  const pages = loadContentNodes('/persist/blog/pages');
  const posts = loadContentNodes('/persist/blog/posts');

  posts.forEach(p => {
    const publishedAt = moment(p.raw.publishedAt);
    if (publishedAt.isValid()) {
      p.publishDate = publishedAt.format('LL [at] LT');
      p.path = `posts/${publishedAt.format('YYYY')}/${p.path}`;
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

    return Mustache.render(layouts.get('default'), {
      siteTitle, siteSubtitle,
      pages, posts,
      innerHtml, baseHref,
    });
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
      posts, pages,
    }, 'home'),
  });

  console.log('Uploading', htmlFiles.length, 'HTML files to web hosting...');
  htmlFiles.forEach(({path, body}) => {
    hosting.callApi('putFile', '/web/blog'+path, body).wait();
  });

  const assetKeys = Object.keys(config.assets);
  console.log('Uploading', assetKeys.length, 'site assets...');
  assetKeys.forEach(asset => {
    const body = config.assets[asset].load().wait();
    hosting.callApi('putFile', '/web/blog'+'/'+asset, body).wait();
  });

  const endTime = new Date();
  const elapsedSecs = Math.round((endTime - startTime) / 1000);
  console.log('Blog published in', elapsedSecs, 'seconds :)');
  process.exit(0);
}).detach();
