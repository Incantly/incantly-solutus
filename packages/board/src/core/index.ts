/** @incantly/board/core: the board's data and logic. No DOM, no timers, no `Date`; runs in Node, a worker and on mobile. */
export { boardError, DONE, isBoardError, ok, okWith, recordInvalid, withDetail } from './errors';
export type { BoardError, BoardErrorKind, BoardNotice, BoardOk, BoardResult } from './errors';
export { copyProps } from './copy';
export { ASSET_BYTES_MAX, DEFAULT_LIMITS, ORIGINS, PAGE_BACKGROUNDS, RECORD_TYPES, isAsset, isBinding, isCamera, isPage, isShape, recordTypeOf } from './types';
export type {
  AssetRecord, BindingRecord, BoardRecord, Bounds, CameraRecord, Diff, Limits, Origin, PageBackground, PageRecord, RecordType, ShapeRecord, Update,
} from './types';
export { FIRST_KEY, isKey, keyBetween, keysBetween } from './fractional';
export {
  ARROW_DEFAULTS, ARROW_HEADS, BEND_MAX, BOX_DEFAULTS, BUILT_IN_KINDS, FIGURE_DEFAULTS, FIGURE_HEADER, FRAME_DEFAULTS, IMAGE_DEFAULTS, KindRegistry, LABEL_PAD, LABEL_PX, LINE_DEFAULTS, LINE_POINTS_MAX,
  SCRIPT_MAX, STICKY_COLOR, STICKY_DEFAULTS, STICKY_PAD, STICKY_W, TEXT_DEFAULTS, TEXT_MIN_W, arrowControl, arrowCurve, arrowKind, builtInKind, diamondKind, ellipseKind, figureKind, frameKind,
  groupKind, headLength, imageKind, lineKind, mapPoints, rectKind, registerBuiltIns, starKind, stickyKind, textKind, textSizeFor, triangleKind,
} from './kinds/index';
export type {
  ArrowHead, ArrowProps, BoxKind, BoxProps, Crop, DrawLod, FigureProps, FrameProps, GroupProps, Handle, ImageProps, KindDef, KindGeometry, LineProps, StickyProps, StylePatch, TextAccess, TextProps,
} from './kinds/index';
export {
  DASHES, FONT_FAMILIES, PATH_CLOSE, PATH_CUBIC, PATH_LINE, PATH_MOVE, cssOrNull, dashFor, ellipsePath, pathPart, polygonPath, polylinePath, roundRectPath,
} from './paint';
export type { ClipBox, Dash, FontFamily, GlyphPart, ImagePart, Part, PathData, PathPart, ShapeItem } from './paint';
export { LINE_HEIGHT, TEXT_ALIGNS, cssFontFor, layoutText, measureGeneration, setFontMeasure, textParts } from './text';
export type { FontMeasure, FontMetrics, LaidLine, TextAlign, TextLayout } from './text';
export { shapeGeometry } from './geometry';
export type { Geometry } from './geometry';
export { EDITOR_MACHINE, TextEditor } from './text-editor';
export type { EditorListener } from './text-editor';
export { GRID_UNITS, SNAP_MACHINE, SNAP_PX, Snapper } from './snap';
export type { MovingSides } from './snap';
export { bindEnd, bindTargetAt, bindingProps, bindingsOfArrow, bindingsOnTarget, boundTarget, dropBindingsOf, followArrow, followBindings, unbindEnd } from './bindings';
export type { ArrowEnd, BindingProps } from './bindings';
export {
  GESTURE_MACHINE, Gesture, alignShapes, beginGesture, deleteShapes, distributeShapes, flipShapes, groupShapes, layoutBox, orderShapes, patchShapes, setLocked, settleParents, styleShapes, translateShapes, turnShapes,
  ungroupShapes, withMembers,
} from './edit';
export type { AlignHow, OrderHow, ShapePatch, WriteOptions } from './edit';
export { frameOf, frameCorners, handleAt, handlesOf, selectionView } from './selection-view';
export type { FrameHandle, HandleId, ResizeHandle, SelectionFrame } from './selection-view';
export { resizePatch, scalePatches } from './transform';
export { pickInBox, pickShape } from './pick';
export { childrenOf, descendantsOf, expandGroups, frameAt, keyOnTop, leavesOf, putNewShape, selectionFor, shapeOf, stackOf } from './shapes';
export { IMAGE_SIDE, addImage, imageProblem, imageSize, sniffImage } from './assets';
export type { ImageMime } from './assets';
export {
  CLIPBOARD_TYPE, PASTE_OFFSET, clipboardText, copySelection, duplicateShapes, isBoardClipboard, isScript, pasteAny, pasteData, pasteScript, pasteText, readClipboardText,
} from './clipboard';
export type { ClipboardData } from './clipboard';
export { FIT_MAX, recogniseStroke } from './ink/recognise';
export type { Recognised } from './ink/recognise';
export { HOLD_MACHINE, HOLD_MIN_LENGTH_PX, HOLD_MIN_POINTS, HOLD_MS, HOLD_SLOP_PX, HoldWatch } from './ink/hold';
export { fixPreview, fixStrokes, strokePoints, strokesToFix } from './fix';
export { PAGE_NAME_MAX, ZOOM_MAX, ZOOM_MIN, checkRecord } from './check';
export type { CheckOptions } from './check';
export { HANDLE_MACHINE, Store, TX_MACHINE } from './store';
export type { ChangeOptions, Changed, StoreListener, StoreOptions, Tx } from './store';
export { HISTORY_MACHINE, History } from './history';
export type { HistoryListener, HistoryOptions } from './history';
export { Pages } from './pages';
export type { AddPageOptions, CurrentListener, PagesState } from './pages';
export { CAMERA_MACHINE, Camera, Cameras, STEADY_DELAY_MS, cameraIdOf, toPage, toScreen } from './camera';
export type { CameraView, Point } from './camera';
export { CELL_SIZE, IndexGrid, pointInPolygon, polygonMeetsBox } from './index-grid';
export { FILE_FORMAT, FILE_VERSION, loadBoard, saveBoard, snapshot, writeDocument } from './file';
export type { BoardDocument, LoadOptions, LoadedBoard, Migration } from './file';
export { BUTTON_BARREL, BUTTON_ERASER, BUTTON_MIDDLE, BUTTON_TIP, MOD_ALT, MOD_MOD, MOD_SHIFT, GATE_ALWAYS_MACHINE, GATE_MACHINE, PALM_GRACE_MS, PROBE_FLAT_SAMPLES, PROBE_MACHINE, PointerGate, PressureProbe } from './input';
export type { Device, GateOptions, GestureInput, InputSample, InputSink, KeyInput, Phase, TouchDraws, Verdict, WheelInput } from './input';
export { MIN_DISTANCE_PX, MIN_PRESSURE_STEP, InkSampler, PointBuffer } from './ink/samples';
export type { Stride } from './ink/samples';
export { NIBS, NIB_SPECS, OutlineCache, Outliner, outlineOf } from './ink/outline';
export type { Nib, NibSpec, Outline, OutlineOptions } from './ink/outline';
export { LIVE_MACHINE, LiveStroke } from './ink/live';
export type { PenStyle } from './ink/live';
export { bakeInkRotation, cutInk, inkBounds, inkPivot, inkToLocal, inkToPage, inkTouches, mostlyInside, pointSegmentDistSq, pointsInside, segmentDistSq } from './ink/geometry';
export { INK_COLOR_DEFAULT, INK_DEFAULTS, INK_SIZE_MAX, inkKind, parseColor } from './kinds/ink';
export type { InkProps } from './kinds/ink';
export { isInk, shapeBounds, unionBounds } from './geometry';
export { PageIndex } from './page-index';
export { Selection } from './selection';
export type { SelectionListener } from './selection';
export {
  DrawList, TILE_BYTES, TILE_CAP_BYTES, TILE_CAP_BYTES_LOW, TILE_MACHINE, TILE_PX, Tile, TileCache, diffRegions, lodOf, regionOf, stepOf, tileBox, tileId, tileSpan,
} from './draw';
export type {
  BoardPainter, DrawItem, GuideLine, InkItem, LiveStrokeView, Lod, OverlayHandle, OverlayItems, PredictedView, SelectionView, TileCacheOptions, TileContent, TrailView,
} from './draw';
export { ACTION_KEYS, KEYMAP_MACHINE, KeyMap, defaultKeyTable, describeKey, normaliseKey } from './keymap';
export type { KeyOption, KeyOptions } from './keymap';
export { ICON_MAX, checkIcon, iconProblem } from './icons';
export { BOARD_STRINGS, Strings } from './strings';
export type { Translate } from './strings';
export { addFigure, figureOf, figuresOnPage, sdkMode, setFigureMode, setFigurePicture, setFigureScript, withHeader } from './figures';
export type { NewFigure } from './figures';
export { BOARD_READ_TOOL, BOARD_TOOL, BoardAgent, RUNNER_MACHINE, boardTools } from './agent';
export type { AgentOptions, AgentToolDef, RunOptions } from './agent';
export { MODEL_META, applyAction } from './agent-actions';
export type { ActionEnv, CallState } from './agent-actions';
export { ANIMATION_MACHINE, HAND_CPS, HAND_MAX_MS, HAND_MIN_MS, HandAnimation, STROKE_UNITS_PER_CHAR, partOf, planLength, planMs, revealText } from './agent-hand';
export type { HandFrame, HandPlan, HandPlayer } from './agent-hand';
export { LAST, PLACE_GAP, occupiedBoxes, resolvePlace, targetBounds } from './agent-place';
export type { PlaceEnv } from './agent-place';
export { ITEM_TEXT_MAX, boundsOfBox, boxOf, describeShape, itemsOf, readBoard, readingOrder, strokeShape } from './agent-read';
export type { FigureHost, ReadEnv } from './agent-read';
export { ACTIONS_MAX, ITEMS_MAX, MARK_HOWS, OPS, SHAPE_KINDS, SIDES, readAction, readActions } from './agent-types';
export type { ActionOk, ActionResult, AgentItem, AgentShapeKind, BoardAction, BoardOp, Box, MarkHow, Place, ReadResult, Side, Target } from './agent-types';
export { AgentJob, AgentService, CIRCLE_CHOICES, ENTRIES_MAX, JOB_MACHINE, describeResult } from './agent-service';
export type {
  AgentEntry, AgentOutcome, AgentServiceOptions, BoardAgentEvent, BoardAgentRequest, BoardAgentTransport, CircleChoice, CircleRequest, TalkRequest,
} from './agent-service';
export { CIRCLE_LABELS, CIRCLE_MACHINE, CircleAsk, suggestionsFor } from './circle';
export type { CircleOptions, Found, Suggestion } from './circle';
export { BoardCore, registerBuiltInKinds } from './board';
export type { BoardCoreOptions } from './board';
export {
  ERASER_MACHINE, HAND_MACHINE, LASER_FADE_MS, LASER_MACHINE, LASER_MAX_POINTS, LASSO_MACHINE, SELECT_MACHINE, SHAPE_TOOLS, SHAPE_TOOL_MACHINE, TOOLS_MACHINE, ToolHost, ToolList, arrowTool, inkTools,
  createOverlayState, defaultStyles, defaultTools, diamondTool, EDIT_ACTIONS, editAction, editKey, ellipseTool, eraserTool, frameTool, handTool, highlighterTool, laserTool, lassoTool, lineTool, penTool, rectTool, selectTool,
  starTool, stickyTool, styledDefaults, textTool, triangleTool, NO_AGENT, askTool,
} from './tools/index';
export type { OverlayState, ShapeStyle, ToolContext, ToolDef, ToolHandlers, ToolStyles } from './tools/index';
