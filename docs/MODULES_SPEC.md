# Module system specification for `@sdo/core` (ESM, npm-style)

## Module contract
```js
export default { id: 'my-module', version: '1.0.0', init(ctx) {} };
```
- `id` unique, semver version.
- `init(ctx)` called once.
- Modules must not import `@sdo/core/src/*` internals; integration only via `ctx`.

## Registries in ctx
- `ctx.registerSchema(schemaDef) -> unregisterFn`
- `ctx.registerCommands(commandDefs | (ctx)=>commandDefs) -> unregisterFn`
- `ctx.registerSettings(settingsDef) -> unregisterFn`
- `ctx.schemas.get/list/resolve`
- `ctx.commands.list/run`
- `ctx.settings.listTabs/getKey/setKey`

## Schema Registry
`SchemaDef` (data-only):
- `id`, `version`, `domain`, `appliesTo`, `fields[]`
- optional `formats[]`, `validators[]`, `migrations[]`

Rules:
- unique `id`
- re-register same `id` only with higher version
- unregister removes schema

## Commands Registry
`CommandDef`:
- required: `id`, `title`, `run(ctx,args)`
- optional: `group`, `order`, `when(ctx)`, `hotkey`, `icon`, `menu`, `confirm`

Rules:
- unique id
- must work in headless mode
- no direct DOM dependency inside command logic

## Settings Registry
`SettingsDef`:
- `id`, `tab { id,title,order? }`, `fields[]`

`SettingsFieldDef`:
- `key`, `label`, `type`, `read(ctx)`, `write(ctx,value)`
- optional: `default`, `options`, `when(ctx)`

Rules:
- key must be namespaced (`moduleId:*`)
- read/write should use `ctx.storage`
- deterministic values for backup

## UI Registry
- `ctx.ui.registerButton(def) -> unregisterFn`
- `ctx.ui.registerPanel(def) -> unregisterFn`
- `ctx.ui.listButtons/listPanels`

Use `order`, `location`, `enabled/visible` guards.

## Storage namespacing
Use only prefixed keys:
- `module-example-table:settings`
- `module-example-table:userData`

## Backup/Encrypt/Sign/Delta
- Backup provider: `ctx.backup.registerProvider({ id, version, describe, export, import })`
- `includeUserData=false` must exclude user data.
- `mode: merge|replace` for imports.
- Encrypt/sign handled by core backup manager (PBKDF2 + AES-GCM, SHA-256 integrity, optional ECDSA).
- Delta: keyed patch `{ revision, set, del }` + module revision/change-log.

## Reference module
See [`docs/reference-module.mjs`](./reference-module.mjs) (`@sdo/module-example-table`), which demonstrates schema/commands/settings/UI/backup/delta.


## Journal templates container
Core includes `@sdo/journal-templates`-style container API on `sdo.journalTemplates`:
- `listTemplates()`
- `getTemplate(id)`
- `addTemplate(template)`
- `deleteTemplate(id)`

Template model:
```json
{ "id": "test", "title": "test", "columns": [{"key":"c1","label":"1"}] }
```
Storage keys: `templates:index`, `templates:tpl:${id}`.
