const Future = require('fibers/future');
const {markdown} = require('markdown');
const Mustache = require('mustache');
const moment = require('moment');
const {basename} = require('path');

const {StartEnvClient, StartClient} = require('../nodejs-domain-client');
Future.task(() => {

  const startTime = new Date();
  console.log('Connecting to profile server...');
  profile = StartEnvClient('blog').wait();

  const path = '/persist/blog/photos';
  profile.listChildNames(path).wait().map(slug => {
    const photoPath = path+'/'+slug;
    const data = profile.loadDataStructure(photoPath, 2).wait();

    if (!data.instagramUrl || data.fullResUrl) {
      return;
    }

    const htmlBody = Future.fromPromise(
      fetch(data.instagramUrl)
      .then(res => res.text())).wait();
    const jsonMatch = htmlBody.match(/window\._sharedData = ([^\n]+);/);
    const pageData = JSON.parse(jsonMatch[1]);
    const mediaData = pageData.entry_data.PostPage[0].graphql.shortcode_media;

    const {shortcode, dimensions, display_url, is_video, taken_at_timestamp} = mediaData;
    const previewUrl = preview_to_jpeg_url(mediaData.media_preview);
    const commentCount = mediaData.edge_media_to_comment.count;
    const likeCount = mediaData.edge_media_preview_like.count;
    const caption = mediaData.edge_media_to_caption.edges[0].node.text;
    console.log(slug, shortcode, dimensions);

    profile.callApi('putString', photoPath+'/caption', caption).wait();
    profile.callApi('putString', photoPath+'/taken at', new Date(taken_at_timestamp*1000).toISOString()).wait();
    profile.callApi('putString', photoPath+'/full res url', display_url).wait();
    profile.callApi('store', photoPath+'/dimensions', Skylink.toEntry('dimensions', {
      width: ''+dimensions.width,
      height: ''+dimensions.height})).wait();
    profile.callApi('putString', photoPath+'/preview url', previewUrl).wait();
  });

  const endTime = new Date();
  const elapsedSecs = Math.round((endTime - startTime) / 1000);
  console.log('Scraped instagram photos in', elapsedSecs, 'seconds :)');
  process.exit(0);
}).detach();

// based on https://stackoverflow.com/questions/49625771/how-to-recreate-the-preview-from-instagrams-media-preview-raw-data/49791447#49791447
function preview_to_jpeg_url(base64data) {
	const jpegtpl = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsaGikdKUEmJkFCLy8vQkc/Pj4/R0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0cBHSkpNCY0PygoP0c/NT9HR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR//AABEIABQAKgMBIgACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AA==",
		t = new Buffer(base64data, 'base64'),
		p = t.slice(3),
		o = [t[0], t[1], t[2]],
		c = new Buffer(jpegtpl, 'base64');
	c[162] = o[1];
	c[160] = o[2];
	return base64data ? "data:image/jpeg;base64," + Buffer.concat([c, p]).toString('base64') : null
};
