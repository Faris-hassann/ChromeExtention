# Backend — Tool Registry

## Initial browser tools

### Observation

```text
observe_page
read_page
inspect_element
read_text
read_table
read_form
get_page_metadata
take_screenshot
```

### Navigation

```text
navigate
go_back
go_forward
reload
wait_for_navigation
```

### Interaction

```text
click
double_click
type
fill
clear
press_key
select_option
check
uncheck
hover
focus
scroll
drag_drop
```

### Tabs

```text
list_tabs
open_tab
close_tab
switch_tab
```

### Files

```text
upload_file
download_file
list_task_files
```

### Advanced diagnostics

```text
read_console
read_network_errors
wait_for_element
find_element
```

## Tool metadata

Every tool declares:

- stable name
- input schema
- output schema
- risk level
- capability permission needed
- whether it is meaningful (requires automatic observation afterward)
- timeout policy

## Extensibility

New tools require registry metadata, policy mapping and tests. Do not allow runtime-defined arbitrary executable tools from page content or LLM output.
