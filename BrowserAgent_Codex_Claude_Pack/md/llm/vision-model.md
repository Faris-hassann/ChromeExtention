# LLM — Vision Model

## Strategy

Architecture is dynamic/provider-based, while V1 uses a separate local vision-capable Qwen model when needed.

## Invoke vision when

- user explicitly asks to interpret a screenshot/image/chart
- semantic DOM is incomplete
- canvas/custom UI contains relevant state
- a control's visual state conflicts with DOM semantics
- visual verification materially improves correctness

## Avoid unnecessary vision calls

Do not send screenshots for every trivial URL/title/read action if semantic state is sufficient.

## Output

Return structured visual findings to the main agent context where practical, not unbounded prose.
