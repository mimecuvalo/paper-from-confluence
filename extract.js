const config = require('./config.json');
const fetch = require('node-fetch');
const fs = require('fs');

let state = {
  stage: 'extraction',
  start: 0,
};
try {
  state = require('./data/state_extraction.json');
} catch (ex) {}

async function getPages() {
  const limit = 100;
  const properties = 'body.view,ancestors,children.attachment';

  while (true) {
    const url = `https://${config.confluence_workspace_name}.atlassian.net/wiki/rest/api/content`
        + `?type=page&start=${state.start}&limit=${limit}&expand=${properties}`;
    const auth = Buffer.from(`${config.confluence_email}:${config.confluence_api_token}`).toString('base64');
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
      }
    });

    const json = await response.json();
    const filename = `./data/confluence_${state.start.toString().padStart(5, '0')}.json`;
    fs.writeFileSync(filename, JSON.stringify(json));

    if (json.size < limit) {
      state.stage = 'extraction-finished';
      state.start += json.size;
      saveState();
      break;
    }
    state.start += limit;
    saveState();
  }
}

function saveState() {
  fs.writeFileSync('./data/state_extraction.json', JSON.stringify(state));
}

async function run() {
  await getPages();
}
run();