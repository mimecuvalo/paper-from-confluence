const config = require('./config.json');
const fs = require('fs');
const os = require('os');
const path = require('path');

const baseUrl = `https://${config.confluence_workspace_name}.atlassian.net/wiki`;

function getResults() {
  const files = fs.readdirSync('./data/pages/');
  let results = [];
  for (const file of files) {
    if (!file.endsWith('json')) {
      continue;
    }
    const json = JSON.parse(fs.readFileSync(`./data/pages/${file}`, 'utf8'));
    results = results.concat(json.results);
  }

  return results;
}

function getAttachments() {
  const results = getResults();

  const attachments = [];
  for (const page of results) {
    if (page.children.attachment) {
      for (const attachment of page.children.attachment.results) {
        attachments.push(`${baseUrl}${attachment._links.download}`);
      }
    }
  }

  return attachments;
}

function getAttachmentLocalTranslation(attachment) {
  const pathname = new URL(attachment).pathname;
  const basename = path.basename(pathname);
  const workspaceId = attachment.match(/\/download\/attachments\/(\d+)/)[1];
  const newBasename = `${workspaceId}-----${basename}`;
  const localPath = `./data/attachments/${newBasename}`;
  const dropboxPath = path.join(config.dropbox_attachments_folder, localPath);

  return { basename, newBasename, localPath, dropboxPath };
}

module.exports = {
  getAttachments,
  getAttachmentLocalTranslation,
  getResults,
}