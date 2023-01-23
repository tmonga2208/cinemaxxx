import { DetailedMeta } from "@/backend/metadata/getmeta";
import { MWMediaMeta, MWMediaType } from "@/backend/metadata/types";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { VideoProgressStore } from "./store";

const FIVETEEN_MINUTES = 15 * 60;
const FIVE_MINUTES = 5 * 60;

function shouldSave(time: number, duration: number): boolean {
  const timeFromEnd = Math.max(0, duration - time);

  // short movie
  if (duration < FIVETEEN_MINUTES) {
    if (time < 5) return false;
    if (timeFromEnd < 60) return false;
    return true;
  }

  // long movie
  if (time < 30) return false;
  if (timeFromEnd < FIVE_MINUTES) return false;
  return true;
}

interface MediaItem {
  meta: MWMediaMeta;
  series?: {
    episodeId: string;
    seasonId: string;
    episode: number;
    season: number;
  };
}

interface WatchedStoreItem {
  item: MediaItem;
  progress: number;
  percentage: number;
  watchedAt: number;
}

export interface WatchedStoreData {
  items: WatchedStoreItem[];
}

interface WatchedStoreDataWrapper {
  updateProgress(media: MediaItem, progress: number, total: number): void;
  getFilteredWatched(): WatchedStoreItem[];
  removeProgress(id: string): void;
  watched: WatchedStoreData;
}

const WatchedContext = createContext<WatchedStoreDataWrapper>({
  updateProgress: () => {},
  getFilteredWatched: () => [],
  removeProgress: () => {},
  watched: {
    items: [],
  },
});
WatchedContext.displayName = "WatchedContext";

function isSameEpisode(media: MediaItem, v: MediaItem) {
  return (
    media.meta.id === v.meta.id &&
    (!media.series ||
      (media.series.seasonId === v.series?.seasonId &&
        media.series.episodeId === v.series?.episodeId))
  );
}

export function WatchedContextProvider(props: { children: ReactNode }) {
  const watchedLocalstorage = VideoProgressStore.get();
  const [watched, setWatchedReal] = useState<WatchedStoreData>(
    watchedLocalstorage as WatchedStoreData
  );

  const setWatched = useCallback(
    (data: any) => {
      setWatchedReal((old) => {
        let newData = data;
        if (data.constructor === Function) {
          newData = data(old);
        }
        watchedLocalstorage.save(newData);
        return newData;
      });
    },
    [setWatchedReal, watchedLocalstorage]
  );

  const contextValue = useMemo(
    () => ({
      removeProgress(id: string) {
        setWatched((data: WatchedStoreData) => {
          const newData = { ...data };
          newData.items = newData.items.filter((v) => v.item.meta.id !== id);
          return newData;
        });
      },
      updateProgress(media: MediaItem, progress: number, total: number): void {
        setWatched((data: WatchedStoreData) => {
          const newData = { ...data };
          let item = newData.items.find((v) => isSameEpisode(media, v.item));
          if (!item) {
            item = {
              item: {
                ...media,
                meta: { ...media.meta },
                series: media.series ? { ...media.series } : undefined,
              },
              progress: 0,
              percentage: 0,
              watchedAt: Date.now(),
            };
            newData.items.push(item);
          }
          // update actual item
          item.progress = progress;
          item.percentage = Math.round((progress / total) * 100);

          // remove item if shouldnt save
          if (!shouldSave(progress, total)) {
            newData.items = data.items.filter(
              (v) => !isSameEpisode(v.item, media)
            );
          }

          return newData;
        });
      },
      getFilteredWatched() {
        let filtered = watched.items;

        // get most recently watched for every single item
        const alreadyFoundMedia: string[] = [];
        filtered = filtered
          .sort((a, b) => {
            return b.watchedAt - a.watchedAt;
          })
          .filter((item) => {
            const mediaId = item.item.meta.id;
            if (alreadyFoundMedia.includes(mediaId)) return false;
            alreadyFoundMedia.push(mediaId);
            return true;
          });
        return filtered;
      },
      watched,
    }),
    [watched, setWatched]
  );

  return (
    <WatchedContext.Provider value={contextValue as any}>
      {props.children}
    </WatchedContext.Provider>
  );
}

export function useWatchedContext() {
  return useContext(WatchedContext);
}

function isSameEpisodeMeta(
  media: MediaItem,
  mediaTwo: DetailedMeta | null,
  episodeId?: string
) {
  if (mediaTwo?.meta.type === MWMediaType.SERIES && episodeId) {
    return isSameEpisode(media, {
      meta: mediaTwo.meta,
      series: {
        season: 0,
        episode: 0,
        episodeId,
        seasonId: mediaTwo.meta.seasonData.id,
      },
    });
  }
  if (!mediaTwo) return () => false;
  return isSameEpisode(media, { meta: mediaTwo.meta });
}

export function useWatchedItem(meta: DetailedMeta | null, episodeId?: string) {
  const { watched, updateProgress } = useContext(WatchedContext);
  const item = useMemo(
    () => watched.items.find((v) => isSameEpisodeMeta(v.item, meta, episodeId)),
    [watched, meta, episodeId]
  );
  const lastCommitedTime = useRef([0, 0]);

  const callback = useCallback(
    (progress: number, total: number) => {
      const hasChanged =
        lastCommitedTime.current[0] !== progress ||
        lastCommitedTime.current[1] !== total;
      if (meta && hasChanged) {
        lastCommitedTime.current = [progress, total];
        const obj = {
          meta: meta.meta,
          series:
            meta.meta.type === MWMediaType.SERIES && episodeId
              ? {
                  seasonId: meta.meta.seasonData.id,
                  episodeId,
                  season: meta.meta.seasonData.number,
                  episode:
                    meta.meta.seasonData.episodes.find(
                      (ep) => ep.id === episodeId
                    )?.number || 0,
                }
              : undefined,
        };
        updateProgress(obj, progress, total);
      }
    },
    [meta, updateProgress, episodeId]
  );

  return { updateProgress: callback, watchedItem: item };
}
