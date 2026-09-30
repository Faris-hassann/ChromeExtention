# Frontend — BrowserDriver

## Shared interface

Implement a driver contract that can support at least:

```ts
observe()
navigate()
click()
doubleClick()
fill()
clear()
pressKey()
selectOption()
check()
uncheck()
hover()
focus()
scroll()
dragDrop()
openTab()
closeTab()
switchTab()
listTabs()
takeScreenshot()
readConsole()
readNetworkErrors()
uploadFile()
downloadFile()
waitForElement()
```

## ExtensionBrowserDriver

Primary driver for the user's installed browser.

It should use extension/browser APIs and content scripts to act on the current authenticated tabs.

## PlaywrightBrowserDriver

Alternative driver owned by the backend/test/dev layer.

It must expose the same logical actions and observations. It may not bypass tool policy or the mandatory observation invariant.

## Driver result

Every action returns a typed action result. After every meaningful action, the runtime must automatically acquire a new BrowserObservation before another agent action is accepted.
