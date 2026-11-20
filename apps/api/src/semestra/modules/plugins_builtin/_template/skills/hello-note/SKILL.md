---
name: hello-note
description: Use when the user asks about their hello note cards or wants to add a line to one.
metadata:
  title: Hello note
  title-zh-CN: Hello 便签
  tools: >-
    layouts.card.list
    hello.note.get
    hello.note.append
---

1. Find the note: call `layouts.card.list` with `card_id: "hello.note"`. Several boards can hold
   a note, so ask which one if it is not clear.
2. To read it, call `hello.note.get` with the card's `instance_id`.
3. To add to it, call `hello.note.append` with one short line. It only appends; tell the user what
   you added. Never try to rewrite the whole note.
