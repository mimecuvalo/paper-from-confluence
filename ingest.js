const config = require('./config.json');
const fetch = require('node-fetch');
const json = require('./data/confluence_00000.json');

let state = {};
try {
  state = require('./data/state_ingestion.json');
} catch (ex) {}

const baseUrl = 'https://ohmconnect.atlassian.net/wiki';
const ancestorsById = {};

async function run() {
  for (const page of json.results) {
    console.log(page.id,
        page.title,
        `${baseUrl}${page._links.webui}`,
        page.ancestors.length,
        page.body.view.value.length);

    // Create folders (ancestors) if necessary.
    for (let i = 0; i < page.ancestors.length; ++i) {
      const ancestor = page.ancestors[i];
      console.log('    ', ancestor.id, ancestor.title, `${baseUrl}${ancestor._links.webui}`);
      if (!ancestorsById[ancestor.id]) {
        const prevAncestorId = i > 0 ? ancestorsById[page.ancestors[i - 1].id].folder_id : undefined;
        const newFolder = await createFolder(ancestor.title, prevAncestorId);
        ancestorsById[ancestor.id] = newFolder;
      }
    }

    // Retrieve attachments
    for (const attachment of page.children.attachment.results) {
      const url = `${baseUrl}${attachment._links.download}`;
      // Download images
      // Upload to dropbox
      // Replace url with new url in page content.
    }

    // Create the doc
    const directAncestorId = ancestorsById[page.id] ? page.id :
        (page.ancestors[page.ancestors.length - 1] && page.ancestors[page.ancestors.length - 1].id);
    const paperFolderId = directAncestorId && ancestorsById[directAncestorId].folder_id;
    const newDoc = await createDoc(page.title, page.body.view.value, paperFolderId);
    console.log(`created new doc: ${newDoc.doc_id}`);
  }
}

async function createFolder(name, parent_folder_id) {
  console.log(`creating folder ${name}`);
  const response = await fetch('https://api.dropboxapi.com/2/paper/folders/create', {
    method: 'POST',
    body: JSON.stringify({
      name,
      is_team_folder: true,
      parent_folder_id,
    }),
    headers: {
      Authorization: `Bearer ${config.dropbox_paper_api_token}`,
      'Content-Type': 'application/json',
    },
  });
  return await response.json();
}

async function createDoc(name, body, parent_folder_id) {
  console.log(`creating doc ${name}`);
  const response = await fetch('https://api.dropboxapi.com/2/paper/docs/create', {
    method: 'POST',
    body: Buffer.from(name + '<br/>' + body),
    headers: {
      Authorization: `Bearer ${config.dropbox_paper_api_token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ import_format: 'html', parent_folder_id }),
    },
  });
  return response.json();
}

run();