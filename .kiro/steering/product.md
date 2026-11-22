---
inclusion: always
---

# Product

## What it is

Incantly is a live blackboard for maths and science. A teacher speaks, and a figure is drawn and changed in real time: points, lines, curves, sliders, motion, particles and sound, all driven by formulas.

Under the hood it is a small formula language and the engine that runs it. Each spoken sentence becomes one or two short lines. Each line defines or changes one object in a live figure, and the figure redraws at once. A figure is saved as its lines, so it can be replayed, edited and shared.

## Who it is for

- **Teachers and tutors** who want to explain an idea while drawing it, without stopping to use a drawing tool.
- **Learners** who want to see an idea move: drag a point, slide a value, pause the lesson and ask a question.
- **Builders** who want to embed live figures in their own apps or documents, through the SDK or the Tiptap extension.

## The hackathon pitch

**A voice-driven live blackboard.** The teacher talks, and the board draws itself.

1. The teacher says: "Take a circle of radius 2, and a point on it."
2. An AI model (a free model on OpenRouter by default, or Muse Spark, through our server) turns that into lines such as `c = Circle((0, 0), 2)` and `P = PointOn(c)`.
3. The kernel checks and applies each line in under a millisecond, and the figure appears.
4. "Now drag the point and show its tangent": the figure changes live, while the teacher keeps talking.
5. When a line is wrong, the error says exactly what to fix, so the model corrects itself on its next line.

What makes it different: errors written for a model to fix, time built in (films that seek and replay exactly), a renderer we wrote ourselves, and figures that stay live inside documents.

## Principles

- One line, one change. A bad line changes nothing and returns an error.
- Real-time: a line in under 1 ms, 60 fps with 500 objects and 20,000 particles.
- The script is the file.
- Safe by design: no JavaScript runs from figures or files.
