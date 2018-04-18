const Future = require('fibers/future');
const {markdown} = require('markdown');

const {StartEnvClient, StartClient} = require('../nodejs-domain-client');
Future.task(() => {

  const startTime = new Date();
  console.log('Connecting to profile servers...');
  profile = StartEnvClient('blog').wait();
  hosting = StartClient('devmode.cloud', 'public', '', 'blog').wait();

  console.log('Generating blog...');
  const config = profile.loadDataStructure('/config/blog').wait();
  const siteTitle = config.siteTitle || 'New Blog';

  const htmlFiles = [];
  let indexHtml = `<!DOCTYPE html>
    <title>${siteTitle}</title>
    <h1>${siteTitle}</h1>
    <h3>Posts</h3>
    <ul>`;

  profile.listChildNames('/persist/blog/pages').wait().forEach(slug => {
    const page = profile.loadDataStructure('/persist/blog/pages/'+slug, 2).wait();
    const pageTitle = page.title || 'Untitled Page';
    // add page to homepage nav
    indexHtml += `<li><a href="${slug}.html">${page.title}</a></li>\n`;

    let innerHtml = '';
    if (page.html) {
      innerHtml = page.html.load().wait();
    } else if (page.markdown) {
      const pageSource = page.markdown.load().wait();
      innerHtml = markdown.toHTML(pageSource);
    }

    htmlFiles.push({
      path: `/${slug}.html`,
      body: `<!DOCTYPE html>
        <title>${page.title} - ${siteTitle}</title>
        <h2><a href="/">${siteTitle}</a></h2>
        <h1>${page.title}</h1>
        <div id="page-body">${innerHtml}</div>`});
  });

  indexHtml += `</ul>`;
  htmlFiles.push({path: '/index.html', body: indexHtml});

  console.log('Uploading', htmlFiles.length, 'HTML files to web hosting...');
  htmlFiles.forEach(({path, body}) => {
    hosting.callApi('putFile', '/web/blog'+path, body).wait();
  });

  const endTime = new Date();
  const elapsedSecs = Math.round((endTime - startTime) / 1000);
  console.log('Blog published in', elapsedSecs, 'seconds :)');
  process.exit(0);
}).detach();
