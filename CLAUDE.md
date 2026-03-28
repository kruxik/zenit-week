# Week Planner — Claude Code Instructions

## Golden rules
- Fix ONLY what is explicitly requested
- Never change other functionality while fixing one thing
- Always preserve existing visual properties unless told otherwise
- One fix per iteration — never bundle multiple changes

## Before every change
- Understand the current behavior first
- Identify the root cause before writing any code
- If uncertain — ask, don't guess

## Code quality
- Single self-contained HTML file — no external dependencies
- No backend — local storage only
- Clean, minimal code — no unnecessary complexity
- Consistent padding/spacing between edit and display states

## Git workflow
- Default branch is always main
- Commit after every working iteration only
- Never commit broken code

## UX rules
- Smooth animations for all state changes (fade, resize)
- No visual noise during interactions
- Edit state and display state must look identical except 
  for dashed vs solid border
- Hover states must appear/disappear smoothly
- Escape key always cancels current action cleanly

## When fixing bugs
- Do not change any other visual properties
- Do not change any other functionality
- State exactly what changed in your response
- If fix introduces new bug — revert and try different approach

## Limits
- Subtasks per branch: 1000
- No other artificial limits unless specified
