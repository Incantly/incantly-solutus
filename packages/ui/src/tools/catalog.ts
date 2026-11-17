/**
 * The tool table (docs/features/tools-2d/design.md 6). Every tool writes ordinary lines; the toolbar, the hints and the
 * model's catalogue are printed from here.
 */
import type { Arg, EmitContext, Slot, ToolGroup, ToolKind, ToolSpec, ToolVariant } from './types';

const ANY_POINT = ['existing', 'free', 'on-path', 'intersection'] as const;
const P = (prompt: string): Slot => ({ kind: 'point', prompt, create: ANY_POINT });
const O = (prompt: string, ...accept: string[]): Slot => ({ kind: 'object', prompt, accept });
/** An object pick that may not be the one picked before it. */
const OD = (prompt: string, ...accept: string[]): Slot => ({ kind: 'object', prompt, accept, distinct: true });
const N = (prompt: string, extra: Partial<Extract<Slot, { kind: 'number' }>> = {}): Slot => ({ kind: 'number', prompt, ...extra });
const STRAIGHT = ['Line', 'Segment', 'Ray'];
const CONIC = ['Circle', 'Conic'];
/** Shapes that can be made solid (physics design 2.1). */
const SOLID = ['Polygon', 'Circle', 'Conic', 'Segment', 'Line', 'Ray', 'Arc', 'Polyline', 'Function', 'Curve'];

const t = (args: readonly Arg[], i: number): string => (args[i] as Arg).text;
const v = (id: string, slots: readonly Slot[], emit: ToolVariant['emit'] | undefined, extra: Partial<ToolVariant> = {}): ToolVariant => ({ id, slots, ...(emit ? { emit } : {}), ...extra });

function tool(id: string, group: ToolGroup, label: string, icon: string, description: string, variants: readonly ToolVariant[], kind: ToolKind = 'construct', sticky = true): ToolSpec {
  return { id, group, label, icon, description, kind, sticky, variants };
}

/** Lines that make one result from all the picks: `{line} = Line(A, B)`. */
const make = (kind: string, cmd: string) => (a: readonly Arg[]): string[] => [`{${kind}} = ${cmd}(${a.map((x) => x.text).join(', ')})`];
/** An angle, or with Alt its reflex complement: the same arms taken the other way round (design 6, angle). */
const angle = (a: readonly Arg[], ctx: EmitContext): string[] => [`{angle} = Angle(${(ctx.alt ? [...a].reverse() : a).map((x) => x.text).join(', ')})`];
/** A typed angle, turned clockwise with Alt (design 6, angle-fixed and rotate). */
const turn = (text: string, ctx: EmitContext): string => (ctx.alt ? `-(${text})` : text);

export const TOOLS: readonly ToolSpec[] = [
  /* move */
  tool('move', 'move', 'Move', '↖', 'Drag free points, points on paths and sliders; click to select.', [], 'mode'),
  tool('move-view', 'move', 'Move view', '✥', 'Drag the background to pan; scroll to zoom.', [], 'mode'),

  /* points */
  tool('point', 'point', 'Point', '•', 'Places a point: free, on a path, or where two objects cross.', [
    v('point', [P('Click to place a point.')], () => []),
  ]),
  tool('point-on-object', 'point', 'Point on object', '⊙', 'Places a point that stays on a line, circle or curve.', [
    v('on', [{ kind: 'point', prompt: 'Click a line, circle or curve.', create: ['on-path'] }], () => []),
  ]),
  tool('intersect', 'point', 'Intersect', '✕', 'Marks where two objects cross.', [
    v('two', [O('Select the first object.', 'Path'), O('Select the second object.', 'Path')], (a, ctx) => {
      const [x, y] = [t(a, 0), t(a, 1)];
      const straight = (s: Arg): boolean => STRAIGHT.includes(s.type);
      if (straight(a[0] as Arg) && straight(a[1] as Arg)) return [`{point} = Intersect(${x}, ${y})`];
      if ((a[0] as Arg).type === 'Function' && (a[1] as Arg).type === 'Function') return [`{list} = Intersect(${x}, ${y}, ${num(ctx.view.x0)}, ${num(ctx.view.x1)})`];
      const n = Math.min(4, ctx.intersections(x, y));
      return Array.from({ length: Math.max(1, n) }, (_, i) => `{point} = Intersect(${x}, ${y}, ${i + 1})`);
    }),
  ]),
  tool('midpoint', 'point', 'Midpoint or centre', '⋅', 'Marks the midpoint of two points or a segment, or the centre of a circle.', [
    v('points', [P('Click the first point.'), P('Click the second point.')], make('point', 'Midpoint')),
    v('segment', [O('Select a segment.', 'Segment')], make('point', 'Midpoint')),
    v('centre', [O('Select a circle or conic.', ...CONIC)], make('point', 'Center')),
  ]),
  tool('roots', 'point', 'Roots', '⨯', 'Marks where a function crosses the x-axis in the view.', [
    v('roots', [O('Select a function.', 'Function')], (a, ctx) => [`{list} = Roots(${t(a, 0)}, ${num(ctx.view.x0)}, ${num(ctx.view.x1)})`]),
  ]),
  tool('extremum', 'point', 'Extremum', '⌒', 'Marks the turning points of a function in the view.', [
    v('extremum', [O('Select a function.', 'Function')], (a, ctx) => [`{list} = Extremum(${t(a, 0)}, ${num(ctx.view.x0)}, ${num(ctx.view.x1)})`]),
  ]),

  /* lines */
  tool('line', 'line', 'Line', '╱', 'Draws the line through two points.', [v('line', [P('Click the first point.'), P('Click the second point.')], make('line', 'Line'))]),
  tool('segment', 'line', 'Segment', '—', 'Draws the segment between two points.', [v('segment', [P('Click the first point.'), P('Click the second point.')], make('line', 'Segment'))]),
  tool('segment-fixed-length', 'line', 'Segment with length', '⊢', 'Draws a segment of a typed length from a point; its end can turn about the start.', [
    v('fixed', [P('Click the start point.'), N('Type the length.', { unit: 'length', def: 3 })], (a) => [
      `{circle#1} = Circle(${t(a, 0)}, ${t(a, 1)})`, `{circle#1} with visible = false`, `{point#end} = PointOn({circle#1}, 0)`, `{line} = Segment(${t(a, 0)}, {point#end})`,
    ]),
  ]),
  tool('ray', 'line', 'Ray', '↗', 'Draws the ray from a point through another.', [v('ray', [P('Click the start point.'), P('Click a point on the ray.')], make('line', 'Ray'))]),
  tool('polyline', 'line', 'Polyline', '⌇', 'Joins points in order without closing; Enter finishes.', [
    v('polyline', [], (a) => [`{line} = Polyline(${a.map((x) => x.text).join(', ')})`], { tail: { slot: P('Click the next point.'), min: 2, max: 1000 } }),
  ]),
  tool('vector', 'line', 'Vector', '→', 'Draws the vector from one point to another.', [v('vector', [P('Click the start point.'), P('Click the end point.')], make('vector', 'Vector'))]),

  /* special lines */
  tool('perpendicular', 'special-line', 'Perpendicular', '⟂', 'Draws the line through a point at right angles to a line.', [
    v('point-line', [P('Click the point.'), O('Select the line.', ...STRAIGHT, 'Vector')], make('line', 'Perpendicular')),
    v('line-point', [O('Select the line.', ...STRAIGHT, 'Vector'), P('Click the point.')], (a) => [`{line} = Perpendicular(${t(a, 1)}, ${t(a, 0)})`]),
  ]),
  tool('parallel', 'special-line', 'Parallel', '∥', 'Draws the line through a point parallel to a line.', [
    v('point-line', [P('Click the point.'), O('Select the line.', ...STRAIGHT, 'Vector')], make('line', 'Parallel')),
    v('line-point', [O('Select the line.', ...STRAIGHT, 'Vector'), P('Click the point.')], (a) => [`{line} = Parallel(${t(a, 1)}, ${t(a, 0)})`]),
  ]),
  tool('perpendicular-bisector', 'special-line', 'Perpendicular bisector', '⊥', 'Draws the line of points equally far from two points.', [
    v('segment', [O('Select a segment.', 'Segment')], make('line', 'Bisector')),
    v('points', [P('Click the first point.'), P('Click the second point.')], make('line', 'Bisector')),
  ]),
  tool('angle-bisector', 'special-line', 'Angle bisector', '∠', 'Halves an angle given by three points, or by two lines.', [
    v('points', [P('Click a point on the first arm.'), P('Click the vertex.'), P('Click a point on the second arm.')], make('line', 'Bisector')),
    v('lines', [O('Select the first line.', ...STRAIGHT), O('Select the second line.', ...STRAIGHT)], make('list', 'Bisector')),
  ]),
  tool('tangents', 'special-line', 'Tangents', '⌓', 'Draws the tangents from a point to a circle or conic, or to a function at a point.', [
    v('point-conic', [P('Click the point.'), O('Select the circle or conic.', ...CONIC)], make('list', 'Tangent')),
    v('function-point', [O('Select the function.', 'Function'), P('Click the point of tangency.')], (a) => [`{line} = Tangent(${t(a, 0)}, ${t(a, 1)}.x)`]),
    v('conics', [O('Select the first circle.', ...CONIC), O('Select the second circle.', ...CONIC)], make('list', 'Tangent')),
  ]),
  tool('polar', 'special-line', 'Polar line', '⊸', 'Draws the polar of a point with respect to a circle or conic.', [
    v('polar', [P('Click the point.'), O('Select the circle or conic.', ...CONIC)], make('line', 'Polar')),
  ]),
  tool('best-fit-line', 'special-line', 'Best-fit line', '⟋', 'Fits a line to the points you click; Enter finishes.', [
    v('fit', [], (a) => [`{list#1} = [${a.map((x) => x.text).join(', ')}]`, `{fit} = FitLine({list#1})`], { tail: { slot: { kind: 'object', prompt: 'Click the next point.', accept: ['Point'] }, min: 2, max: 500 } }),
  ]),
  tool('locus', 'special-line', 'Locus', '∿', 'Traces the path of a point as another point moves along its path.', [
    v('locus', [O('Select the point that traces.', 'Point'), O('Select the point that moves.', 'Point')], make('locus', 'Locus')),
  ]),

  /* polygons */
  tool('polygon', 'polygon', 'Polygon', '▱', 'Joins points into a polygon; click the first point or press Enter to close.', [
    v('polygon', [], (a) => [`{polygon} = Polygon(${a.map((x) => x.text).join(', ')})`], { tail: { slot: P('Click the next vertex.'), min: 3, max: 200, closeOnFirst: true } }),
  ]),
  tool('regular-polygon', 'polygon', 'Regular polygon', '⬠', 'Builds a regular polygon on a side, counter-clockwise.', [
    v('regular', [P('Click the first vertex.'), P('Click the second vertex.'), N('Type the number of sides.', { unit: 'count', def: 5, range: [3, 100], integer: true })], make('polygon', 'Polygon')),
  ]),

  /* circles and arcs */
  tool('circle-center-point', 'circle-arc', 'Circle: centre and point', '◯', 'Draws the circle with a centre through a point.', [
    v('circle', [P('Click the centre.'), P('Click a point on the circle.')], make('circle', 'Circle')),
  ]),
  tool('circle-center-radius', 'circle-arc', 'Circle: centre and radius', '◎', 'Draws the circle with a centre and a typed radius.', [
    v('circle', [P('Click the centre.'), N('Type the radius.', { unit: 'length', def: 2, range: [0, Infinity] })], make('circle', 'Circle')),
  ]),
  tool('compass', 'circle-arc', 'Compass', '⊚', 'Copies a length: a circle about a new centre with the radius of a segment, or of two points.', [
    v('segment', [O('Select the segment for the radius.', 'Segment'), P('Click the new centre.')], (a) => [`{circle} = Circle(${t(a, 1)}, Length(${t(a, 0)}))`]),
    v('circle', [O('Select the circle for the radius.', 'Circle'), P('Click the new centre.')], (a) => [`{circle} = Circle(${t(a, 1)}, ${t(a, 0)}.radius)`]),
    v('points', [P('Click the first point of the radius.'), P('Click the second point.'), P('Click the new centre.')], (a) => [`{circle} = Circle(${t(a, 2)}, Distance(${t(a, 0)}, ${t(a, 1)}))`]),
  ]),
  tool('circle-three-points', 'circle-arc', 'Circle through 3 points', '◌', 'Draws the circle through three points.', [
    v('circle', [P('Click the first point.'), P('Click the second point.'), P('Click the third point.')], make('circle', 'Circle')),
  ]),
  tool('semicircle', 'circle-arc', 'Semicircle', '◠', 'Draws the semicircle on two points, counter-clockwise.', [
    v('semi', [P('Click the first end.'), P('Click the second end.')], make('circle', 'Semicircle')),
  ]),
  tool('arc-center', 'circle-arc', 'Arc: centre and two points', '◜', 'Draws the arc about a centre from a start point toward an end point, counter-clockwise.', [
    v('arc', [P('Click the centre.'), P('Click the start.'), P('Click toward the end.')], make('circle', 'Arc')),
  ]),
  tool('arc-three-points', 'circle-arc', 'Arc through 3 points', '◝', 'Draws the arc through three points.', [
    v('arc', [P('Click the start.'), P('Click a point on the arc.'), P('Click the end.')], make('circle', 'ArcThrough')),
  ]),
  tool('sector-center', 'circle-arc', 'Sector: centre and two points', '◔', 'Draws the sector about a centre from a start point toward an end point.', [
    v('sector', [P('Click the centre.'), P('Click the start.'), P('Click toward the end.')], make('region', 'Sector')),
  ]),
  tool('sector-three-points', 'circle-arc', 'Sector through 3 points', '◕', 'Draws the sector of the arc through three points.', [
    v('sector', [P('Click the start.'), P('Click a point on the arc.'), P('Click the end.')], make('region', 'SectorThrough')),
  ]),

  /* conics */
  tool('ellipse', 'conic', 'Ellipse', '⬭', 'Draws the ellipse with two foci through a point.', [
    v('ellipse', [P('Click the first focus.'), P('Click the second focus.'), P('Click a point on the ellipse.')], make('conic', 'Ellipse')),
  ]),
  tool('hyperbola', 'conic', 'Hyperbola', '⋈', 'Draws the hyperbola with two foci through a point.', [
    v('hyperbola', [P('Click the first focus.'), P('Click the second focus.'), P('Click a point on the hyperbola.')], make('conic', 'Hyperbola')),
  ]),
  tool('parabola', 'conic', 'Parabola', '∪', 'Draws the parabola with a focus and a directrix.', [
    v('parabola', [P('Click the focus.'), O('Select the directrix.', ...STRAIGHT)], make('conic', 'Parabola')),
  ]),
  tool('conic-five-points', 'conic', 'Conic through 5 points', '⬯', 'Draws the conic through five points.', [
    v('conic', [P('Click the first point.'), P('Click the second point.'), P('Click the third point.'), P('Click the fourth point.'), P('Click the fifth point.')], make('conic', 'Conic')),
  ]),

  /* measurement */
  tool('angle', 'measure', 'Angle', '∡', 'Measures an angle, counter-clockwise from the first arm to the second.', [
    v('points', [P('Click a point on the first arm.'), P('Click the vertex.'), P('Click a point on the second arm.')], angle),
    v('lines', [O('Select the first line or segment.', ...STRAIGHT), O('Select the second.', ...STRAIGHT)], angle),
    v('vectors', [O('Select the first vector.', 'Vector'), O('Select the second vector.', 'Vector')], angle),
  ]),
  tool('angle-fixed', 'measure', 'Angle with size', '∢', 'Turns a point about a vertex by a typed angle, counter-clockwise.', [
    v('fixed', [P('Click a point on the first arm.'), P('Click the vertex.'), N('Type the angle, such as 40°.', { unit: 'angle', def: 0.6981317 })], (a, ctx) => [
      `{point#end} = Rotate(${t(a, 0)}, ${turn(t(a, 2), ctx)}, ${t(a, 1)})`, `{angle} = Angle(${t(a, 0)}, ${t(a, 1)}, {point#end})`,
    ]),
  ]),
  tool('distance-length', 'measure', 'Distance or length', '↔', 'Measures the distance between two objects, or the length of one.', [
    v('points', [{ kind: 'object', prompt: 'Select the first point or line.', accept: ['Point'] }, O('Select a point or line.', 'Point', ...STRAIGHT, ...CONIC, 'Polygon')], (a) => [`{number} = Distance(${t(a, 0)}, ${t(a, 1)})`]),
    v('lines', [O('Select the first line.', ...STRAIGHT), O('Select the second line.', ...STRAIGHT)], make('number', 'Distance')),
    v('length', [O('Select a segment, vector, arc, circle or polygon.', 'Segment', 'Vector', 'Arc', 'Polyline', 'Circle', 'Polygon')], (a) => [
      (a[0] as Arg).type === 'Circle' || (a[0] as Arg).type === 'Polygon' ? `{number} = Perimeter(${t(a, 0)})` : `{number} = Length(${t(a, 0)})`,
    ]),
  ]),
  tool('area', 'measure', 'Area', '▦', 'Measures the area of a polygon, circle, conic or sector.', [
    v('area', [O('Select a polygon, circle or sector.', 'Polygon', 'Circle', 'Conic', 'Sector')], make('number', 'Area')),
  ]),
  tool('slope', 'measure', 'Slope', '⦨', 'Measures the slope of a line.', [v('slope', [O('Select a line.', ...STRAIGHT, 'Vector')], make('number', 'Slope'))]),
  tool('create-list', 'measure', 'List', '[ ]', 'Makes a list of the objects you click, all of one kind; Enter finishes.', [
    v('list', [], (a) => [`{list} = [${a.map((x) => x.text).join(', ')}]`], { tail: { slot: O('Click the next object.', 'Any'), min: 1, max: 500 } }),
  ]),
  tool('relation', 'measure', 'Relation', '≟', 'Tells how two objects relate: equal, parallel, perpendicular, on, crossing.', [
    v('relation', [O('Select the first object.', 'Any'), O('Select the second object.', 'Any')], make('relation', 'Relation')),
  ], 'query'),

  /* transformations */
  tool('reflect-line', 'transform', 'Reflect about a line', '⇋', 'Mirrors an object in a line.', [
    v('reflect', [O('Select the object to reflect.', 'Shape', 'Function'), O('Select the mirror line.', ...STRAIGHT)], (a) => [`{${imageKind(a[0] as Arg)}} = Reflect(${t(a, 0)}, ${t(a, 1)})`]),
  ]),
  tool('reflect-point', 'transform', 'Reflect about a point', '⊛', 'Mirrors an object through a point (a half turn).', [
    v('reflect', [O('Select the object to reflect.', 'Shape', 'Function'), P('Click the centre.')], (a) => [`{${imageKind(a[0] as Arg)}} = Reflect(${t(a, 0)}, ${t(a, 1)})`]),
  ]),
  tool('reflect-circle', 'transform', 'Invert in a circle', '◐', 'Inverts a point, line or circle in a circle.', [
    v('invert', [O('Select the object to invert.', 'Point', 'Line', 'Circle'), O('Select the circle.', 'Circle')], (a) => [`{${imageKind(a[0] as Arg)}} = Reflect(${t(a, 0)}, ${t(a, 1)})`]),
  ]),
  tool('rotate-angle', 'transform', 'Rotate', '↻', 'Turns an object about a point by a typed angle, counter-clockwise.', [
    v('rotate', [O('Select the object to rotate.', 'Shape'), P('Click the centre.'), N('Type the angle, such as 45°.', { unit: 'angle', def: 0.7853982 })], (a, ctx) => [`{${imageKind(a[0] as Arg)}} = Rotate(${t(a, 0)}, ${turn(t(a, 2), ctx)}, ${t(a, 1)})`]),
  ]),
  tool('translate-vector', 'transform', 'Translate', '⇢', 'Moves an object by a vector.', [
    v('translate', [O('Select the object to move.', 'Shape', 'Function'), O('Select the vector.', 'Vector')], (a) => [`{${imageKind(a[0] as Arg)}} = Translate(${t(a, 0)}, ${t(a, 1)})`]),
  ]),
  tool('dilate', 'transform', 'Dilate', '⤢', 'Enlarges an object from a point by a typed factor.', [
    v('dilate', [O('Select the object to enlarge.', 'Shape', 'Function'), P('Click the centre.'), N('Type the factor.', { unit: 'factor', def: 2 })], (a) => [`{${imageKind(a[0] as Arg)}} = Dilate(${t(a, 0)}, ${t(a, 2)}, ${t(a, 1)})`]),
  ]),

  /* action objects */
  tool('slider', 'action', 'Slider', '⊷', 'Adds a number slider; type its starting value.', [
    v('slider', [N('Type the starting value.', { def: 1 })], (a) => [`{number} = ${t(a, 0)} in ${Math.min(-5, (a[0] as Arg).value ?? 0)}..${Math.max(5, (a[0] as Arg).value ?? 0)} step 0.1`]),
  ], 'construct', false),
  tool('check-box', 'action', 'Check box', '☑', 'Adds a true or false check box that shows or hides the objects you click; Enter finishes.', [
    v('box', [], (a) => ['{bool#1} = true', ...a.map((x) => `${x.text} with showIf = {bool#1}`)], { tail: { slot: O('Click an object it shows and hides.', 'Any'), min: 0, max: 50 } }),
  ], 'construct', false),

  /* general */
  tool('zoom-in', 'general', 'Zoom in', '⊕', 'Click to zoom in about the click.', [], 'mode'),
  tool('zoom-out', 'general', 'Zoom out', '⊖', 'Click to zoom out about the click.', [], 'mode'),
  tool('show-hide-object', 'general', 'Show or hide', '◑', 'Click objects to hide them; hidden objects show faintly while the tool is on.', [
    v('toggle', [O('Click an object to show or hide.', 'Any')], undefined, { act: (a) => ({ op: 'toggle-visible', name: t(a, 0) }) }),
  ], 'edit'),
  tool('delete', 'general', 'Delete', '⌫', 'Click an object to delete it and what is built on it.', [
    v('delete', [O('Click the object to delete.', 'Any')], undefined, { act: (a) => ({ op: 'delete', name: t(a, 0) }) }),
  ], 'edit'),

  /* physics (docs/features/physics/ui.md 3) */
  tool('make-solid', 'physics', 'Make solid', '▦', 'Click shapes to make them solid walls that bodies hit.', [
    v('solid', [O('Click a shape to make it solid.', ...SOLID)], (a) => [`${t(a, 0)} with solid = true`]),
  ]),
  tool('make-body', 'physics', 'Make body', '◼', 'Click a closed shape to make it a body that falls, slides and bounces.', [
    v('body', [O('Click a closed shape. A line can only be made solid.', 'Polygon', 'Circle', 'Conic')], (a) => [`{body} = Body(${t(a, 0)}, mass = 1)`]),
  ]),
  tool('ground', 'physics', 'Ground', '▁', 'Adds a solid floor at a height.', [
    v('ground', [N('Type the height of the ground.', { unit: 'length', def: 0 })], (a) => [`{ground} = Ground(${t(a, 0)})`]),
  ]),
  tool('hinge', 'physics', 'Hinge', '◎', 'Click a body, a second body or a solid shape, then the point they turn about.', [
    v('hinge', [O('Click a body.', 'Body'), OD('Click a second body or a solid shape.', 'Body', ...SOLID), P('Click the point they turn about.')], make('joint', 'Hinge')),
  ]),
  tool('spring', 'physics', 'Spring', '⌇', 'Click two bodies (or a body and a solid shape) to join them with a spring.', [
    v('spring', [O('Click a body.', 'Body'), OD('Click the other end.', 'Body', ...SOLID)], (a) => [`{joint} = Spring(${t(a, 0)}, ${t(a, 1)}, 50)`]),
  ]),
  tool('rope', 'physics', 'Rope', '∿', 'Click two bodies (or a body and a solid shape) to tie them with a rope as long as they are apart.', [
    v('rope', [O('Click a body.', 'Body'), OD('Click the other end.', 'Body', ...SOLID), N('Type the rope length.', { unit: 'length', def: 2 })], make('joint', 'Rope')),
  ]),
  tool('weld', 'physics', 'Weld', '✚', 'Click two touching bodies to make them move as one.', [
    v('weld', [O('Click a body.', 'Body'), OD('Click the body to weld it to.', 'Body')], make('joint', 'Weld')),
  ]),
  tool('push', 'physics', 'Push', '➶', 'Click a body, then where to push it toward: a kick that size.', [
    v('push', [O('Click a body.', 'Body'), { kind: 'position', prompt: 'Click where to push it toward.' }], (a) => {
      const at = (a[1] as Arg & { at?: { x: number; y: number } }).at;
      const b = t(a, 0);
      return at ? [`Push(${b}, (${num(at.x)} - ${b}.x, ${num(at.y)} - ${b}.y))`] : [];
    }),
  ]),
  tool('water', 'physics', 'Water', '≈', 'Click a box for the tank, then the height of the water: bodies in it float.', [
    v('water', [O('Click the tank: a box or a polygon.', 'Polygon'), { kind: 'position', prompt: 'Click the height of the water.' }], (a) => {
      const at = (a[1] as Arg & { at?: { x: number; y: number } }).at;
      return at ? [`{water} = Water(${t(a, 0)}, ${num(at.y)})`] : [];
    }),
  ]),
  tool('liquid', 'physics', 'Liquid', '∴', 'Click two corners of a box to fill it with 500 drops of liquid.', [
    v('liquid', [{ kind: 'position', prompt: 'Click a corner of the box to fill.' }, { kind: 'position', prompt: 'Click the opposite corner.' }], (a) => {
      const p = (a[0] as Arg & { at?: { x: number; y: number } }).at;
      const q = (a[1] as Arg & { at?: { x: number; y: number } }).at;
      if (!p || !q || p.x === q.x || p.y === q.y) return [];
      return [`{liquid} = Liquid(Box((${num((p.x + q.x) / 2)}, ${num((p.y + q.y) / 2)}), ${num(Math.abs(q.x - p.x))}, ${num(Math.abs(q.y - p.y))}), 500)`];
    }),
  ]),
  tool('smoke', 'physics', 'Smoke', '☁', 'Click two corners of a box for the air, then where the smoke comes from: it rises and drifts with the wind.', [
    v('smoke', [{ kind: 'position', prompt: 'Click a corner of the box of air.' }, { kind: 'position', prompt: 'Click the opposite corner.' }, { kind: 'position', prompt: 'Click where the smoke comes from.' }], (a) => {
      const p = (a[0] as Arg & { at?: { x: number; y: number } }).at;
      const q = (a[1] as Arg & { at?: { x: number; y: number } }).at;
      const s = (a[2] as Arg & { at?: { x: number; y: number } }).at;
      if (!p || !q || !s || p.x === q.x || p.y === q.y) return [];
      // a source a twentieth of the box wide, as a small fire or a chimney
      const r = Math.min(Math.abs(q.x - p.x), Math.abs(q.y - p.y)) / 20;
      return [`{smoke} = Smoke(Box((${num((p.x + q.x) / 2)}, ${num((p.y + q.y) / 2)}), ${num(Math.abs(q.x - p.x))}, ${num(Math.abs(q.y - p.y))}), 48, source = Circle((${num(s.x)}, ${num(s.y)}), ${num(r)}))`];
    }),
  ]),
];


function imageKind(a: Arg): string {
  const base = /^(\w+)/.exec(a.type)?.[1] ?? a.type;
  switch (base) {
    case 'Point': return 'point';
    case 'Line': case 'Segment': case 'Ray': case 'Polyline': return 'line';
    case 'Vector': return 'vector';
    case 'Circle': case 'Arc': return 'circle';
    case 'Conic': case 'Curve': return 'conic';
    case 'Polygon': return 'polygon';
    case 'Sector': return 'region';
    case 'Function': return 'function';
    default: return 'list';
  }
}

function num(x: number): string {
  return String(Number(x.toPrecision(6)));
}

/** Tools left out of v1, with the reason (requirements, decided against the design). */
export const DEFERRED: Readonly<Record<string, string>> = {
  'rotate-around': 'needs a drag gesture that writes new free values; the Move tool covers dragging',
  'freehand-shape': 'needs a sketch recogniser',
  'record-to-table': 'needs the spreadsheet',
  'complex-number': 'no complex numbers in v1',
  'attach-detach': 'needs redefinition from the view; type the line instead',
  'vector-from-point': 'needs vector arithmetic on points in a command',
  'polar-diameter (diameter)': 'no Diameter command yet',
  'rigid-polygon': 'needs the physics kit',
  'vector-polygon': 'needs the arrow style on polygon edges',
  'function-inspector': 'a panel, not a construction',
  text: 'no Text command yet',
  image: 'needs assets',
  pen: 'needs the stroke simplifier',
  'freehand-function': 'needs a recogniser',
  button: 'buttons are made from lines in controls-scripting',
  'input-box': 'input boxes are made from lines in controls-scripting',
  'show-hide-label': 'labels are not figure styles in the studio yet',
  'copy-style': 'colours are not figure styles in the studio yet',
};

export const GROUPS: readonly { readonly id: ToolGroup; readonly label: string }[] = [
  { id: 'move', label: 'Move' }, { id: 'point', label: 'Points' }, { id: 'line', label: 'Lines' },
  { id: 'special-line', label: 'Special lines' }, { id: 'polygon', label: 'Polygons' }, { id: 'circle-arc', label: 'Circles and arcs' },
  { id: 'conic', label: 'Conics' }, { id: 'measure', label: 'Measure' }, { id: 'transform', label: 'Transform' },
  { id: 'action', label: 'Controls' }, { id: 'physics', label: 'Physics' }, { id: 'general', label: 'General' },
];

export const toolById = (id: string): ToolSpec | undefined => TOOLS.find((x) => x.id === id);

/** The model's recipe catalogue: one line per tool (agent.md 1.1). */
export function catalogText(): string {
  return TOOLS.map((x) => `${x.id}: ${x.description}`).join('\n');
}
