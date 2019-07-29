const common = require('./common');
const config = require('./config.json');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

let state = {
  stage: 'extraction',
  start: 0,
};
try {
  state = require('./data/state_extraction.json');
} catch (ex) {}

const AUTH = Buffer.from(`${config.confluence_email}:${config.confluence_api_token}`).toString('base64');

async function getPages() {
  const limit = 100;
  const properties = (
    'ancestors,' +
    'body.view,' +
    'children.attachment,' +
    'children.comment,' +
    'metadata.labels,' +
    'restrictions.read.restrictions.user,' +
    'restrictions.update.restrictions.user,' +
    'history,' +
    'history.contributors'
  );

  while (true) {
    console.log(`Fetching page ${state.start}`);

    const url = `https://${config.confluence_workspace_name}.atlassian.net/wiki/rest/api/content`
        + `?type=page&start=${state.start}&limit=${limit}&expand=${properties}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${AUTH}`,
      }
    });

    const json = await response.json();
    const filename = `./data/pages/confluence_${state.start.toString().padStart(5, '0')}.json`;
    fs.writeFileSync(filename, JSON.stringify(json));

    if (json.size < limit) {
      state.stage = 'extraction-finished';
      state.start += json.size;
      saveState();
      console.log(`Fetch a total of ${state.start} pages.`);
      break;
    }
    state.start += limit;
    saveState();
  }
}

async function getAttachments() {
  state.stage = 'attachments';
  saveState();

  const attachments = common.getAttachments();
  console.log(`Fetching ${attachments.length} attachments.`);

  for (const attachment of attachments) {
    const { localPath, newBasename } = common.getAttachmentLocalTranslation(attachment);

    if (fs.existsSync(`${localPath}`)) {
      console.log(`Found attachment: ${newBasename}`);
      continue;
    }

    console.log(`Fetching attachment: ${newBasename}`);
    const response = await fetch(attachment, {
      headers: {
        'Authorization': `Basic ${AUTH}`,
      }
    });
    const buffer = await response.buffer();
    fs.writeFileSync(`${localPath}`, buffer);
  }

  state.stage = 'attachments-finished';
  saveState();
}

async function getUsers() {
  state.stage = 'users';
  saveState();

  const pages = common.getResults();

  const users = {};
  for (const page of pages) {
    if (page.history.createdBy.accountId) {
      users[page.history.createdBy.accountId] = true;
    }
    const accounts = page.body.view.value.match(/data-account-id="[^"]+"/g);
    if (accounts) {
      accounts.forEach(a => users[a.slice(17, -1)] = true);
    }
  }

  const userIds = Object.keys(users);
  console.log(`Found ${userIds.length} users. Fetching emails...`);
  fs.writeFileSync(`./data/users.json`, JSON.stringify({ userIds }));

  state.stage = 'users-finished';
  saveState();
}

function saveState() {
  fs.writeFileSync('./data/state_extraction.json', JSON.stringify(state));
}

async function run() {
  fs.mkdirSync('./data/pages/', { recursive: true });
  fs.mkdirSync('./data/attachments/', { recursive: true });

  if (state.stage === 'extraction') {
    await getPages();
  } else {
    console.log('Already did extraction, skipping.')
  }
  if (state.stage === 'extraction-finished' || state.stage === 'attachments') {
    await getAttachments();
  }
  if (state.stage === 'attachments-finished' || state.stage === 'users') {
    await getUsers();
  }
  if (state.stage === 'users-finished') {
    console.log('Extraction is finished.');
    console.log('(delete ./data/state_extraction.json to restart.)\n🎉🎉🎉');
  }
}
run();