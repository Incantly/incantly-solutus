/** @incantly/board/core: the board's data and logic. No DOM, no timers, no `Date`; runs in Node, a worker and on mobile. */
export { boardError, DONE, isBoardError, ok, okWith, recordInvalid, withDetail } from './errors';
export type { BoardError, BoardErrorKind, BoardNotice, BoardOk, BoardResult } from './errors';
export { copyProps } from './copy';
export { ASSET_BYTES_MAX, DEFAULT_LIMITS, ORIGINS, PAGE_BACKGROUNDS, RECORD_TYPES, isAsset, isBinding, isCamera, isPage, isShape, recordTypeOf } from './types';
export type {
  AssetRecord, BindingRecord, BoardRecord, Bounds, CameraRecord, Diff, Limits, Origin, PageBackground, PageRecord, RecordType, ShapeRecord, Update,
} from './types';
export { FIRST_KEY, isKey, keyBetween, keysBetween } from './fractional';
export { KindRegistry } from './kinds/index';
export type { KindDef } from './kinds/index';
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
export { BUTTON_BARREL, BUTTON_ERASER, BUTTON_MIDDLE, BUTTON_TIP, GATE_ALWAYS_MACHINE, GATE_MACHINE, PALM_GRACE_MS, PROBE_FLAT_SAMPLES, PROBE_MACHINE, PointerGate, PressureProbe } from './input';
export type { Device, GateOptions, GestureInput, InputSample, InputSink, KeyInput, Phase, TouchDraws, Verdict, WheelInput } from './input';
export { MIN_DISTANCE_PX, MIN_PRESSURE_STEP, InkSampler, PointBuffer } from './ink/samples';
export type { Stride } from './ink/samples';
export { NIBS, NIB_SPECS, OutlineCache, Outliner, outlineOf } from './ink/outline';
export type { Nib, NibSpec, Outline, OutlineOptions } from './ink/outline';
export { LIVE_MACHINE, LiveStroke } from './ink/live';
export type { PenStyle } from './ink/live';
export { cutInk, inkBounds, inkTouches, mostlyInside, pointSegmentDistSq, pointsInside, segmentDistSq } from './ink/geometry';
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
  BoardPainter, DrawItem, InkItem, LiveStrokeView, Lod, OverlayItems, PredictedView, TileCacheOptions, TileContent, TrailView,
} from './draw';
export { BoardCore, registerBuiltInKinds } from './board';
export type { BoardCoreOptions } from './board';
export {
  ERASER_MACHINE, HAND_MACHINE, LASER_FADE_MS, LASER_MACHINE, LASER_MAX_POINTS, LASSO_MACHINE, TOOLS_MACHINE, ToolHost, ToolList, createOverlayState, defaultStyles, defaultTools,
  eraserTool, handTool, highlighterTool, laserTool, lassoTool, penTool,
} from './tools/index';
export type { OverlayState, ToolContext, ToolDef, ToolHandlers, ToolStyles } from './tools/index';
