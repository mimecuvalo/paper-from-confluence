const common = require('./common');
const config = require('./config.json');
const fetch = require('node-fetch');
const fs = require('fs');
const mime = require('mime/lite');
const path = require('path');

let state = {
  stage: 'transferring',
  attachmentsMap: {},
  folderMap: {},
  docMap: {},
};
try {
  state = require('./data/state_ingestion.json');
} catch (ex) {}

const baseUrl = `https://${config.confluence_workspace_name}.atlassian.net/wiki`;

async function transferAttachments() {
  state.stage = 'transferring';
  saveState();

  const attachments = common.getAttachments();
  console.log(`Moving ${attachments.length} attachments.`);

  for (const attachment of attachments) {
    const { localPath, dropboxPath, basename } = common.getAttachmentLocalTranslation(attachment);
    const dirname = path.dirname(dropboxPath);
    fs.mkdirSync(dirname, { recursive: true });
    if (!fs.existsSync(localPath) && fs.existsSync(dropboxPath)) {
      console.log(`Already moved ${basename}, skipping.`)
      continue;
    }
    fs.renameSync(localPath, dropboxPath);
  }

  state.stage = 'transferring-finished';
  saveState();
}

async function getDropboxLinks() {
  state.stage = 'dropbox-links';
  saveState();

  if (!state.attachmentsMap) {
    state.attachmentsMap = {};
  }

  const response = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    body: 'null',
    headers: {
      Authorization: `Bearer ${config.dropbox_paper_api_token}`,
      'Content-Type': 'application/json',
    },
  });
  const userInfo = await response.json();
  const namespaceId = userInfo.root_info.root_namespace_id;

  const attachments = common.getAttachments();
  console.log(`Getting links for ${attachments.length} attachments.`);

  for (const attachment of attachments) {
    const { dropboxPath, newBasename } = common.getAttachmentLocalTranslation(attachment);
    if (state.attachmentsMap[attachment]) {
      console.log(`Already got link for ${newBasename}, skipping.`);
      continue;
    }

    console.log(`Getting link for ${newBasename}.`);

    const response = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
      method: 'POST',
      body: JSON.stringify({
        path: dropboxPath.replace(config.dropbox_root_folder, ''),
      }),
      headers: {
        Authorization: `Bearer ${config.dropbox_paper_api_token}`,
        'Dropbox-Api-Path-Root': `{".tag": "namespace_id", "namespace_id": "${namespaceId}"}`,
        'Content-Type': 'application/json',
      },
    });
    const linkInfo = await response.json();
    const url = linkInfo.url || (linkInfo.error && linkInfo.error.shared_link_already_exists &&
        linkInfo.error.shared_link_already_exists.metadata.url);
    state.attachmentsMap[attachment] = {
      url,
      dropboxPath: dropboxPath,
    };
    saveState();
  }

  state.stage = 'dropbox-links-finished';
  saveState();
}

async function importDocs() {
  state.stage = 'ingest';
  saveState();

  const results = common.getResults();
  if (!state.folderMap) {
    state.folderMap = {};
  }
  if (!state.docMap) {
    state.docMap = {};
  }

  console.log(`Ingesting ${results.length} docs.`);

  for (const page of results) {
    let view = page.body.view.value;

    // Retrieve attachments
    view = view.replace(/srcset="[^"]+"/g, '');
    const otherAttachments = [];
    for (const attachment of page.children.attachment.results) {
      const url = `${baseUrl}${attachment._links.download}`;
      const info = state.attachmentsMap[url];
      const pathname = new URL(url).pathname;
      const basename = path.basename(pathname);

      const isImage = mime.getType(basename) && mime.getType(basename).startsWith('image/');
      if (isImage) {
        const dropboxUrl = info.url.replace('?dl=0', '?dl=1');
        view = view.replace(new RegExp(`src="[^"]+${basename}[^"]+"`, 'g'), `src="${dropboxUrl}"`);
      } else {
        const dropboxUrl = info.url;
        otherAttachments.push({ attachment, basename, dropboxUrl } );
      }
    }
    if (page.metadata.labels.results.length) {
      view += '<h2>Labels</h2><ul>'
          + page.metadata.labels.results.map(label => `<li>#${label.name}</li>`)
          + '</ul>';
    }
    if (otherAttachments.length) {
      view += '<h1>Attachments</h1><ul>' + otherAttachments.map(a =>
        `<li><a href="${a.dropboxUrl}" target="_blank" rel="noopener noreferrer">${a.basename}</a></li>`
      ) + '</ul>';
    }

    if (!page.ancestors.length) {
      page.ancestors = [{ id: 'Unfiled', title: 'Unfiled' }];
    }

    // Create folders (ancestors) if necessary.
    for (let i = 0; i < page.ancestors.length; ++i) {
      const ancestor = page.ancestors[i];
      if (!state.folderMap[ancestor.id]) {
        const prevAncestorId = i > 0 ? state.folderMap[page.ancestors[i - 1].id].folder_id : undefined;
        await createFolder(ancestor.title, prevAncestorId, ancestor.id);
      } else {
        console.log(`\tFound folder ${state.folderMap[ancestor.id].name} already, skipping creation.`);
      }
    }

    // Create the doc
    const directAncestorId = state.folderMap[page.id] ? page.id :
        (page.ancestors[page.ancestors.length - 1] && page.ancestors[page.ancestors.length - 1].id);
    const paperFolderId = directAncestorId && state.folderMap[directAncestorId].folder_id;
    await createDoc(page.title, view, paperFolderId, page.id);
  }

  state.stage = 'ingest-finished';
  saveState();
}

async function createFolder(name, parent_folder_id, ancestorId) {
  console.log(`\tcreating folder ${name}, id:${ancestorId}`);
  const response = await fetch('https://api.dropboxapi.com/2/paper/folders/create', {
    method: 'POST',
    body: JSON.stringify({
      name: name.replace(/%/g, ''),
      is_team_folder: true,
      parent_folder_id,
    }),
    headers: {
      Authorization: `Bearer ${config.dropbox_paper_api_token}`,
      'Content-Type': 'application/json',
    },
  });

  const json = await response.json();
  state.folderMap[ancestorId] = {
    name,
    parent_folder_id,
    folder_id: json.folder_id,
  };
  saveState();

  return json;
}

async function createDoc(name, body, parent_folder_id, pageId) {
  if (state.docMap[pageId]) {
    console.log(`Found doc ${name} already, skipping creation.`);
    return state.docMap[pageId];
  }

  console.log(`creating doc ${name}, id:${pageId}`);
  const response = await fetch('https://api.dropboxapi.com/2/paper/docs/create', {
    method: 'POST',
    body: Buffer.from(name + '<br/>' + body),
    headers: {
      Authorization: `Bearer ${config.dropbox_paper_api_token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ import_format: 'html', parent_folder_id }),
    },
  });

  const json = await response.json();
  state.docMap[pageId] = {
    name,
    parent_folder_id,
    doc_id: json.doc_id,
  };
  saveState();
  console.log(`created new doc: ${json.doc_id}`);

  return json;
}

async function docToDocMap() {
  state.stage = 'doc-to-doc-map';
  saveState();

  const results = common.getResults();

  console.log(`Mapping ${results.length} docs.`);

  for (const page of results) {
    let view = page.body.view.value;

    // Retrieve links, if any.
    const links = view.match(/<a[^>]+pages\/(\d+)[^>]+>.+?<\/a>/g);
    if (!links) {
      console.log(`No links found for ${page.id}. Skipping...`);
      continue;
    }

    for (const link of links) {
      const confluenceDocId = link.match(/pages\/(\d+)/)[1];
      const docInfo = state.docMap[confluenceDocId];
      if (!docInfo) {
        console.log(`ERROR: couldn't find ${confluenceDocId}`);
        continue;
      }

      view = view.replace(new RegExp(`${escapeRegExp(link)}`, 'g'),
          `<span class="mention internal">` +
            `<a class="mention-content mention-pad" data-mentionpadid="${docInfo.doc_id}" ` +
                `data-mentiontext="${docInfo.name}" href="https://paper.dropbox.com/doc/${docInfo.doc_id}">` +
              `+<span dir="auto" class="notranslate">${docInfo.name}</span>`+
            `</a>` +
          `</span>`);
    }

    // Update the doc
    await updateDoc(page.title, view, page.id);
  }

  state.stage = 'doc-to-doc-map-finished';
  saveState();
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function updateDoc(name, body, pageId) {
  if (state.docMap[pageId].updated) {
    console.log(`Updated doc ${name} already, skipping updating.`);
    return state.docMap[pageId];
  }

  console.log(`updating doc ${name}, id:${pageId}`);
  const response = await fetch('https://api.dropboxapi.com/2/paper/docs/update', {
    method: 'POST',
    body: Buffer.from(name + '<br/>' + body),
    headers: {
      Authorization: `Bearer ${config.dropbox_paper_api_token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        doc_id: state.docMap[pageId].doc_id,
        doc_update_policy: 'overwrite_all',
        revision: 1,  // This is *probably* correct.
        import_format: 'html' }),
    },
  });

  const json = await response.json();
  state.docMap[pageId].updated = true;
  saveState();
  console.log(`updated doc: ${json.doc_id}`);

  return json;
}

function saveState() {
  fs.writeFileSync('./data/state_ingestion.json', JSON.stringify(state));
}

async function run() {
  if (state.stage === 'transferring') {
    await transferAttachments();
  } else {
    console.log('Already did transfer of attachments, skipping.')
  }
  if (state.stage === 'transferring-finished' || state.stage === 'dropbox-links') {
    await getDropboxLinks();
  } else {
    console.log('Already got Dropbox links, skipping.')
  }
  if (state.stage === 'dropbox-links-finished' || state.stage === 'ingest') {
    await importDocs();
  }
  if (state.stage === 'ingest-finished' || state.stage === 'doc-to-doc-map') {
    await docToDocMap();
  }
  if (state.stage === 'doc-to-doc-map-finished') {
    console.log('Ingestion is finished. (delete ./data/state_ingestion.json to restart.)\n🎉🎉🎉')
  }
}
run();