# Sound: how an AI model uses it

## Catalogue entries

```text
Tone(frequency: Number, gain?: Number, wave?: Text, pan?: Number) -> Sound
Noise(color: Text, gain?: Number, pan?: Number) -> Sound
Melody(notes: List<Number>, beat: Number, gain?: Number, wave?: Text, loop?: Bool) -> Sound
Note(frequency: Number, seconds: Number, gain?: Number, wave?: Text)
Sonify(f: Function, a: Number, b: Number, seconds: Number, low?: Number, high?: Number)
Mute(s: Sound)  Unmute(s: Sound)
note(name: Text) -> Number   midi(n: Number) -> Number   semitones(f: Number, n: Number) -> Number
```

About 140 tokens.

## Rules for the model

- Sound is off until the learner turns it on. If the lesson needs sound, the teacher says so: "Tap the speaker to hear it."
- Keep gains at 0.3 or below when two or more sounds play together.
- Describe only what `draw` reported. If the result has a notice such as `out_of_range`, say the sound was clamped.

## Lesson snippet: beats

Teacher: "Here is a tone at 440 hertz."

```text
a = Tone(440, 0.3)
```

Teacher: "Now a second tone, just a little higher. Listen to the wobble: that is a beat."

```text
d = 3 in 0..10
b = Tone(440 + d, 0.3)
```

Teacher: "Drag d. The wobble speeds up as the two tones move apart."

## Lesson snippet with recovery

Model writes `Note("A4", 1)`. The result is `no_matching_form`: the frequency must be a Number, not a Text, and the hint says to wrap the name as `note("A4")`. The model's next call writes:

```text
Note(note("A4"), 1)
```
