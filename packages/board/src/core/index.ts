/** @incantly/board/core: the board's data and logic. No DOM, no timers, no `Date`; runs in Node, a worker and on mobile. */
export { boardError, DONE, isBoardError, ok, recordInvalid, withDetail } from './errors';
export type { BoardError, BoardErrorKind, BoardOk, BoardResult } from './errors';
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
