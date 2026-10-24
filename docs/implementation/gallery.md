# The community gallery

Learners publish figures they made, with the request that made them; reviewers accept the good ones for everyone, and promote the best into reviewed scenes, which feed the examples the pipeline builds from (PRD GL-1, BR-13).

## Publishing

A figure in a note can be published when the service made it: its ticket, the service's signature on its plan and fragments (RP-7), proves that. The host asks the TipTap view for what the gallery needs, adds the learner's request, and sends it:

```ts
const view = figureViews.get(figureElement);
const publication = await view?.publication(); // { ticket, fragments, title } or null without a ticket
if (publication) await client.publish({ ...publication, prompt: 'Why does a ball thrown at 45 degrees go the furthest?' });
```

`POST /v1/gallery` checks the ticket, which gives back the plan, and runs today's validator over the fragments; a figure edited by hand, made elsewhere or no longer valid is refused. The same figure published twice is one entry. Each learner can have 20 entries waiting for review (`galleryPendingLimit`). The entry keeps the request, the title (the learner's, or the plan's concept), the plan, the fragments, the SDK version and a one-way hash of the learner, used only to count what they have waiting and never shown. Publishing is the learner's choice to share their words, so this is the one place the service keeps a request; `GET /v1/status` says so in its retention notes.

## Review

Nothing is listed until a reviewer accepts it. With the service keeping its gallery in `INCANTLY_GALLERY_DIR` (one JSON file per entry), reviewers use the gallery command:

```sh
INCANTLY_GALLERY_DIR=/srv/incantly/gallery npm run gallery -- list            # waiting for review
INCANTLY_GALLERY_DIR=/srv/incantly/gallery npm run gallery -- show <id>       # the request, the plan, whether it passes today, and the scene
INCANTLY_GALLERY_DIR=/srv/incantly/gallery npm run gallery -- accept <id>
INCANTLY_GALLERY_DIR=/srv/incantly/gallery npm run gallery -- reject <id> too close to the reviewed projectile scene
```

Review the figure as a learner would meet it: run it from the playground, check the physics or the maths against the plan's idea, and read the request for anything a learner should not see.

## The gallery for learners

`GET /v1/gallery` lists the accepted figures, newest first, with their title, request and idea; `GET /v1/gallery/:id` gives one with its fragments and a fresh ticket of its own, so a note that adds it can have it repaired or changed like a figure it made. The generation client wraps both (`client.gallery()`, `client.galleryFigure(id)`), and the host inserts the figure with `insertFigure`. The generate page in the playground shows the whole loop: publish the selected figure, review it through a dev endpoint, and add it to the note from the gallery.

## Promotion

An accepted figure that teaches its concept well can become a reviewed scene:

```sh
INCANTLY_GALLERY_DIR=/srv/incantly/gallery npm run gallery -- promote <id> ball-range
npm run generate && npm run check
```

`promote` checks the plan and the scene again and writes `packages/core/scenes/<scene-id>/`: the three fragments, the plan, and `match.json` with the concept and title as names and the request's content words as keywords. From then on it is a reviewed scene like the others: the pipeline can start from it, build from it in place of a plan call, and fall back to it, and the browser gallery check runs it in light and dark. Read the scene and its match words before committing it, as for any reviewed scene, and tune the words so it is picked for the requests it answers and not for others.
