import { useTacticalStore } from '../store/tacticalStore'
import { visibleGroups, findItem, PEEK_IDS, type LaunchItem } from '../lib/launcher'
import { launch } from './useLaunch'
import { VersionTag } from './VersionTag'

function Tile({ item, badge, accent }: { item: LaunchItem; badge?: number; accent?: boolean }) {
  return (
    <button
      onClick={() => launch(item)}
      title={item.hint}
      className={`relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center active:scale-95 ${
        accent ? 'border-tactical-cyan/60 bg-tactical-cyan/10' : 'border-slate-700/80 bg-slate-900/60'
      }`}
    >
      {badge ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-tactical-cyan px-1 text-[0.5625rem] font-bold text-slate-900">
          {badge}
        </span>
      ) : null}
      <span className="text-[1.375rem] leading-none">{item.icon}</span>
      <span className={`text-[0.6875rem] font-semibold leading-tight ${accent ? 'text-tactical-cyan' : 'text-slate-100'}`}>
        {item.label}
      </span>
    </button>
  )
}

/** 抽屜收起時那一排：最常用的五個，大大的、一按就到。 */
export function LauncherPeek() {
  return (
    <div className="grid grid-cols-5 gap-1.5 px-3 pb-2">
      {PEEK_IDS.map((id) => {
        const it = findItem(id)
        return it ? <Tile key={id} item={it} accent={id === 'quickscan'} /> : null
      })}
    </div>
  )
}

/**
 * 全部功能：依「要做什麼事」分組，一屏看完不用橫滑。
 *
 * 不再放「最近用過」那一排：收起時的那五格已經是固定的常用鍵，
 * 展開後上面是那五格、下面又一排最近用過、再下面才是分組，同一個按鈕出現三次。
 * 常用鍵固定不動也比較好——海上搖晃時靠位置記憶按，不能讓按鈕自己換位置。
 */
export function Launcher() {
  const radarLocked = useTacticalStore((s) => s.secureHasLock && !s.secureUnlocked)
  const repeaters = useTacticalStore((s) => s.repeaters)
  const lookouts = useTacticalStore((s) => s.lookouts)
  const radarSites = useTacticalStore((s) => s.radarSites)
  const poiPoints = useTacticalStore((s) => s.poiPoints)
  const groups = visibleGroups({ radarLocked })

  // 各工具的資料筆數：一眼看出哪些已經在用
  const badge: Record<string, number> = {
    radio: repeaters.length,
    lookout: lookouts.length,
    radar: radarLocked ? 0 : radarSites.length,
    fieldops: poiPoints.length,
  }

  return (
    <div className="flex flex-col gap-3 pb-2 pt-1">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="mb-1.5 text-[0.6875rem] font-bold text-slate-400">{g.title}</h3>
          <div className="grid grid-cols-4 gap-1.5">
            {g.items.map((it) => (
              <Tile key={it.id} item={it} badge={badge[it.id]} accent={it.id === 'quickscan'} />
            ))}
          </div>
        </section>
      ))}
      <div className="flex justify-center pt-1">
        <VersionTag />
      </div>
    </div>
  )
}
