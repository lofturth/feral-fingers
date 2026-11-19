# Piano Trainer decks

Use **Load Deck** to replace the current session with a local JSON file. Decks are not saved between visits. The built-in example is `decks/sample.json`.

Version 1 format:

```json
{
  "schemaVersion": 1,
  "id": "my-deck",
  "title": "My Deck",
  "exercises": [
    { "id": "phrase-1", "label": "C major", "notes": [60, 64, 67] }
  ]
}
```

Deck and exercise IDs and labels must be non-empty strings. Exercise IDs must be unique within the deck. The exercises array and every notes array must be non-empty; notes are integer MIDI pitches from 0 through 127. Invalid files leave the current session intact.
