// Entry point for the lazy-loaded comment editor bundle (vendor/editor.<hash>.js).
//
// RE-EXPORTS ONLY. No application logic may live here - not the schema, not the
// Markdown bridge, not autosave, not the loader. Those stay in zenit-week.html
// under the single-file policy; this file exists only because third-party code
// is too heavy to inline. Each package is exposed as its own namespace so the
// page reads e.g. `pm.model.Schema` and names never collide across packages.
//
// Build with `npm run editor:build` (scripts/build-editor.mjs).
export * as model from 'prosemirror-model';
export * as state from 'prosemirror-state';
export * as view from 'prosemirror-view';
export * as transform from 'prosemirror-transform';
export * as history from 'prosemirror-history';
export * as keymap from 'prosemirror-keymap';
export * as inputrules from 'prosemirror-inputrules';
export * as commands from 'prosemirror-commands';
export * as schemaList from 'prosemirror-schema-list';
