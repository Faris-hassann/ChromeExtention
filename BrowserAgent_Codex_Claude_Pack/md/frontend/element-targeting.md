# Frontend — Element Targeting

## LLM contract

The LLM chooses semantic element IDs when possible, not CSS/XPath.

## Resolver priority

1. ARIA role + accessible name
2. label association
3. placeholder/title
4. stable data/name/id attributes
5. visible text
6. safe CSS fallback
7. visual coordinates/bounding box when necessary

## Stale references

If `el_123` no longer exists:

- return `STALE_ELEMENT_REFERENCE`
- automatically re-observe
- let the agent choose again

Do not repeatedly click old coordinates/selectors.

## Highlighting

Before/while executing visible actions, briefly highlight the element if this can be done without changing the page's functional behavior.
