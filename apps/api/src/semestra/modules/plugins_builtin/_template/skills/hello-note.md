---
name: hello-note
description: Read or add to the user's hello note cards.
---

Use this when the user talks about their "hello note".

1. Find the note: call `layouts.board.get` for the board the user means (the current course, term
   or Program) and look for cards with `card_id` `hello.note`. Several boards can hold a note, so
   ask which one if it is not clear.
2. To read it, call `hello.note.get` with the card's `instance_id`.
3. To add to it, call `hello.note.append` with one short line. It only appends; tell the user what
   you added. Never try to rewrite the whole note.
