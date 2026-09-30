# LLM — Context Management

## Principle

Use compact semantic context, not whole-page HTML by default.

## Include

- current goal
- current plan step
- relevant task memory
- current observation summary
- changed elements/content
- relevant interactive elements
- relevant tables/forms
- recent action/result
- policy constraints

## On-demand expansion

The agent may request a trusted tool to inspect a specific element/section or raw DOM excerpt when needed.

## Avoid

- repeatedly sending unchanged full DOM
- including unrelated page sections
- storing long task transcripts after session
- retaining screenshots unless necessary for the immediate model call
