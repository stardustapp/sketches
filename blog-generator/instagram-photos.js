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

  const path = '/data/blog/photos';
  profile.listChildNames(path).wait().map(slug => {
    const photoPath = path+'/'+slug;
    const data = profile.loadDataStructure(photoPath, 2).wait();

    if (!data.instagramUrl || data.fullResUrl) {
      if (!process.argv.includes('--freshen'))
        return;
    }

    const htmlBody = Future.fromPromise(
      fetch(data.instagramUrl)
      .then(res => res.text())).wait();
    const jsonMatch = htmlBody.match(/window\._sharedData = ([^\n]+);/);
    const pageData = JSON.parse(jsonMatch[1]);
    const mediaData = pageData.entry_data.PostPage[0].graphql.shortcode_media;
    // console.log(JSON.stringify(mediaData, null, 2));

    const {shortcode, dimensions, display_url, is_video} = mediaData;
    console.log(slug, shortcode, dimensions);

    const commentCount = (
      mediaData.edge_media_to_parent_comment
      || mediaData.edge_media_to_comment
    ).count;
    const likeCount = mediaData.edge_media_preview_like.count;
    const addlTexts = [ `${likeCount} like${likeCount!==1?'s':''}` ];

    const caption = mediaData.edge_media_to_caption.edges[0].node.text;
    const takenAt = new Date(mediaData.taken_at_timestamp*1000);
    const takenMonth = takenAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    let altText = `Photo posted on ${takenMonth}`;
    const previewUrl = preview_to_jpeg_url(mediaData.media_preview);

    if (commentCount > 0) {
      const commentText = `${commentCount} comment${commentCount!==1?'s':''}`;
      addlTexts.push(commentText);
      altText = `${altText}, plus ${commentText}`;
    }

    profile.callApi('putString', photoPath+'/caption', [
      caption, '', `Posted ${takenMonth}`, addlTexts.join(', ')
    ].join('\n')).wait();
    profile.callApi('putString', photoPath+'/taken at', takenAt.toISOString()).wait();
    profile.callApi('putString', photoPath+'/alternative', altText).wait();
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
const jpegtpl = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsaGikdKUEmJkFCLy8vQkc/Pj4/R0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0cBHSkpNCY0PygoP0c/NT9HR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR//AABEIABQAKgMBIgACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AA==";
function preview_to_jpeg_url(inputString) {
  if (!inputString) return null;
	const dynamic = Buffer.from(inputString, 'base64');
	const payload = dynamic.slice(3);
	const template = Buffer.from(jpegtpl, 'base64');
	template[162] = dynamic[1];
	template[160] = dynamic[2];
	return "data:image/jpeg;base64," + Buffer
    .concat([template, payload])
    .toString('base64');
};
