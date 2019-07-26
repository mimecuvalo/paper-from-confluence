# Instructions

Setup config:
```sh
cp config.json.example config.json
```
and then, edit `config.json` with appropriate values.

Setup Dropbox API:
- create a Dropbox app at the [Dropbox App Console](https://www.dropbox.com/developers/apps?_tk=pilot_lp&_ad=topbar4&_camp=myapps)
- click on "Generate" under "Generated access token" on your new app.

Setup Confluence API:
- visit [API tokens](https://id.atlassian.com/manage/api-tokens) (under Manage your account):
- click "Create API token"

Extraction:
```sh
node extract.js
```
`state_extraction.json` is created to keep track of state so you can resume if something goes wrong.

Ingestion:
```sh
node ingest.js
```
`state_ingestion.json` is created to keep track of state so you can resume if something goes wrong.

# Documentation
- [Paper API](https://www.dropbox.com/developers/documentation/http/documentation#paper)
- [Paper API explorer](https://dropbox.github.io/dropbox-api-v2-explorer/)
- [Confluence API](https://developer.atlassian.com/cloud/confluence/rest/#api-group-Content)

# Todos
- images
- fix user links
- fix doc links
- attachments
- history
- permissions