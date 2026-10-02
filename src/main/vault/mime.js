'use strict';

const path = require('node:path');

const TYPES = {
  // images
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  // video
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv', '.ogv': 'video/ogg', '.3gp': 'video/3gpp',
  // audio
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.opus': 'audio/opus', '.flac': 'audio/flac', '.weba': 'audio/webm',
  // documents
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.rtf': 'application/rtf', '.odt': 'application/vnd.oasis.opendocument.text',
  // text
  '.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/plain', '.log': 'text/plain', '.json': 'text/plain',
  '.xml': 'text/plain', '.ini': 'text/plain', '.yaml': 'text/plain', '.yml': 'text/plain', '.html': 'text/plain',
  '.htm': 'text/plain', '.css': 'text/plain', '.js': 'text/plain',
  // archives
  '.zip': 'application/zip', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
};

const ARCHIVES = new Set(['application/zip', 'application/x-7z-compressed', 'application/vnd.rar']);

function mimeFor(fileName) {
  return TYPES[path.extname(fileName).toLowerCase()] || 'application/octet-stream';
}

// Category used for filtering in the UI.
function categoryFor(mime) {
  if (mime.startsWith('image/')) return 'photos';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  if (ARCHIVES.has(mime) || mime === 'application/octet-stream') return 'other';
  if (mime.startsWith('text/') || mime.startsWith('application/')) return 'documents';
  return 'other';
}

module.exports = { mimeFor, categoryFor };
