# Frontend — Tabs, Frames & Shadow DOM

## Tabs

Support:

- list tabs
- open tab
- close agent-created tab
- switch tab
- detect new popup/tab
- track active tab changes

When a new tab appears, report it in the observation. Qwen decides whether switching is appropriate.

## User intervention

If the user changes the page/tab manually while the agent is running:

1. detect relevant change
2. re-observe
3. do not assume the previous step is still current
4. allow agent to adapt

## Frames

Build a frame tree in observations. Expose semantic elements within interactable frames when permitted.

## Shadow DOM

Support open Shadow DOM traversal and semantic extraction. Keep this transparent to Qwen where possible.
