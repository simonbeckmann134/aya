import { observer } from 'mobx-react-lite'
import LunaToolbar, {
  LunaToolbarHtml,
  LunaToolbarSelect,
  LunaToolbarSeparator,
  LunaToolbarSpace,
} from 'luna-toolbar/react'
import LunaLogcat from 'luna-logcat/react'
import Logcat from 'luna-logcat'
import map from 'licia/map'
import rpad from 'licia/rpad'
import dateFormat from 'licia/dateFormat'
import toNum from 'licia/toNum'
import trim from 'licia/trim'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import store from '../../store'
import copy from 'licia/copy'
import download from 'licia/download'
import toStr from 'licia/toStr'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import contextMenu from 'share/renderer/lib/contextMenu'
import {
  createLogcatSearch,
  getLogcatSearchEntries,
  matchesLogcatSearch,
} from './search'
import { highlightLogcat } from './highlight'
import HistoryInput from './HistoryInput'
import {
  addLogcatSearchHistory,
  createEmptyLogcatSearchHistory,
  LogcatSearchHistoryKey,
  mergeLogcatSearchHistory,
  normalizeLogcatSearchHistory,
} from './history'
import Style from './Logcat.module.scss'

const MAX_LOG_ENTRIES = 10000
const LOGCAT_SEARCH_HISTORY_STORE = 'logcatSearchHistory'

export default observer(function Logcat() {
  const [view, setView] = useState<'compact' | 'standard'>('standard')
  const [softWrap, setSoftWrap] = useState(false)
  const [paused, setPaused] = useState(false)
  const [query, setQuery] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHistory, setSearchHistory] = useState(
    createEmptyLogcatSearchHistory
  )
  const [searchHistoryLoaded, setSearchHistoryLoaded] = useState(false)
  const search = useMemo(
    () => createLogcatSearch(searchQuery, useRegex, matchCase),
    [searchQuery, useRegex, matchCase]
  )
  const searchRef = useRef(search.expression)
  const searchErrorId = useId()
  const [filter, setFilter] = useState<{
    priority?: number
    package?: string
    tag?: string
  }>({})
  const logcatRef = useRef<Logcat>(null)
  const entriesRef = useRef<any[]>([])
  const logcatIdRef = useRef('')

  const { device } = store

  useEffect(() => {
    let active = true
    main.getMainStore(LOGCAT_SEARCH_HISTORY_STORE).then((value) => {
      if (active) {
        const stored = normalizeLogcatSearchHistory(value)
        setSearchHistory((current) =>
          mergeLogcatSearchHistory(current, stored)
        )
        setSearchHistoryLoaded(true)
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (searchHistoryLoaded) {
      main.setMainStore(LOGCAT_SEARCH_HISTORY_STORE, searchHistory)
    }
  }, [searchHistory, searchHistoryLoaded])

  useEffect(() => {
    // Avoid rebuilding a large log buffer for every keystroke.
    if (!query) {
      setSearchQuery('')
      return
    }
    const timer = setTimeout(() => setSearchQuery(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    searchRef.current = search.expression
  }, [search.expression])

  useEffect(() => {
    function onLogcatEntry(id, entry) {
      if (logcatIdRef.current !== id) {
        return
      }
      if (logcatRef.current) {
        entriesRef.current.push(entry)
        if (matchesLogcatSearch(entry.message, searchRef.current)) {
          logcatRef.current.append(entry)
        }
      }
    }
    const offLogcatEntry = main.on('logcatEntry', onLogcatEntry)
    if (device) {
      main.openLogcat(device.id).then((id) => {
        logcatIdRef.current = id
      })
    }

    return () => {
      offLogcatEntry()
      if (logcatIdRef.current) {
        main.closeLogcat(logcatIdRef.current)
      }
    }
  }, [])

  if (store.panel !== 'logcat') {
    if (!paused && logcatIdRef.current) {
      main.pauseLogcat(logcatIdRef.current)
    }
  } else {
    if (!paused && logcatIdRef.current) {
      main.resumeLogcat(logcatIdRef.current)
    }
  }

  function save() {
    const data = map(entriesRef.current, (entry) => {
      return trim(
        `${dateFormat(entry.date, 'mm-dd HH:MM:ss.l')} ${rpad(
          entry.pid,
          5,
          ' '
        )} ${rpad(entry.tid, 5, ' ')} ${toLetter(entry.priority)} ${
          entry.tag
        }: ${entry.message}`
      )
    }).join('\n')
    const name = `${store.device ? store.device.name : 'logcat'}.${dateFormat(
      'yyyymmddHH'
    )}.txt`

    download(data, name, 'text/plain')
  }

  function clear() {
    if (logcatRef.current) {
      logcatRef.current.clear()
      // Reset Luna's displayed-entry cache as well as its virtual list.
      logcatRef.current.setOption('filter', { ...filter })
    }
    entriesRef.current = []
  }

  function commitHistory(key: LogcatSearchHistoryKey, value: string) {
    if (key === 'keyword' && createLogcatSearch(value, useRegex).error) {
      return
    }
    setSearchHistory((history) => addLogcatSearchHistory(history, key, value))
  }

  function deleteHistory(key: LogcatSearchHistoryKey, value: string) {
    setSearchHistory((history) => ({
      ...history,
      [key]: history[key].filter((item) => item !== value),
    }))
  }

  function clearHistory(key: LogcatSearchHistoryKey) {
    setSearchHistory((history) => ({ ...history, [key]: [] }))
  }

  const onContextMenu = (e: PointerEvent, entry: any) => {
    e.preventDefault()
    const logcat = logcatRef.current!
    const template: any[] = [
      {
        label: t('copy'),
        click: () => {
          if (logcat.hasSelection()) {
            copy(logcat.getSelection())
          } else if (entry) {
            copy(entry.message)
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('clear'),
        click: clear,
      },
    ]

    contextMenu(e, template)
  }

  return (
    <div className={Style.container}>
      <LunaToolbar
        className={Style.toolbar}
        onChange={(key, val) => {
          switch (key) {
            case 'view':
              setView(val)
              break
            case 'priority':
              setFilter({
                ...filter,
                priority: toNum(val),
              })
              break
            case 'package':
              setFilter({
                ...filter,
                package: val,
              })
              break
            case 'tag':
              setFilter({
                ...filter,
                tag: val,
              })
              break
          }
        }}
      >
        <LunaToolbarSelect
          keyName="view"
          disabled={!device}
          value={view}
          options={{
            [t('standardView')]: 'standard',
            [t('compactView')]: 'compact',
          }}
        />
        <LunaToolbarSeparator />
        <LunaToolbarSelect
          keyName="priority"
          disabled={!device}
          value={toStr(filter.priority || 2)}
          options={{
            VERBOSE: '2',
            DEBUG: '3',
            INFO: '4',
            WARNING: '5',
            ERROR: '6',
          }}
        />
        <LunaToolbarHtml className={Style.historyField}>
          <HistoryInput
            value={filter.package || ''}
            history={searchHistory.package}
            placeholder={t('package')}
            onChange={(value) => setFilter({ ...filter, package: value })}
            onCommit={(value) => commitHistory('package', value)}
            onDelete={(value) => deleteHistory('package', value)}
            onClear={() => clearHistory('package')}
          />
        </LunaToolbarHtml>
        <LunaToolbarHtml className={Style.historyField}>
          <HistoryInput
            value={filter.tag || ''}
            history={searchHistory.tag}
            placeholder={t('tag')}
            onChange={(value) => setFilter({ ...filter, tag: value })}
            onCommit={(value) => commitHistory('tag', value)}
            onDelete={(value) => deleteHistory('tag', value)}
            onClear={() => clearHistory('tag')}
          />
        </LunaToolbarHtml>
        <LunaToolbarHtml className={Style.search}>
          <HistoryInput
            type="search"
            className={Style.keywordHistoryInput}
            placeholder={t('searchLogMessages')}
            ariaLabel={t('searchLogMessages')}
            invalid={search.error}
            describedBy={search.error ? searchErrorId : undefined}
            maxLength={1000}
            value={query}
            history={searchHistory.keyword}
            onChange={setQuery}
            onCommit={(value) => commitHistory('keyword', value)}
            onDelete={(value) => deleteHistory('keyword', value)}
            onClear={() => clearHistory('keyword')}
            onEscape={() => setQuery('')}
          />
          <button
            type="button"
            className={Style.searchButton}
            title={t('clearLogSearch')}
            aria-label={t('clearLogSearch')}
            disabled={!query}
            onClick={() => setQuery('')}
          >
            ×
          </button>
          <button
            type="button"
            className={Style.searchButton}
            title={t('useRegularExpression')}
            aria-label={t('useRegularExpression')}
            aria-pressed={useRegex}
            onClick={() => setUseRegex(!useRegex)}
          >
            .*
          </button>
          <button
            type="button"
            className={Style.searchButton}
            title={t('matchCase')}
            aria-label={t('matchCase')}
            aria-pressed={matchCase}
            onClick={() => setMatchCase(!matchCase)}
          >
            Aa
          </button>
        </LunaToolbarHtml>
        <LunaToolbarSpace />
        <ToolbarIcon
          icon="save"
          title={t('save')}
          onClick={save}
          disabled={!device}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="soft-wrap"
          state={softWrap ? 'hover' : ''}
          title={t('softWrap')}
          onClick={() => setSoftWrap(!softWrap)}
        />
        <ToolbarIcon
          icon="scroll-end"
          title={t('scrollToEnd')}
          onClick={() => logcatRef.current?.scrollToEnd()}
          disabled={!device}
        />
        <ToolbarIcon
          icon="reset"
          title={t('restart')}
          onClick={() => {
            if (logcatIdRef.current) {
              main.closeLogcat(logcatIdRef.current)
              clear()
            }
            if (device) {
              main.openLogcat(device.id).then((id) => {
                logcatIdRef.current = id
              })
            }
          }}
          disabled={!device}
        />
        <ToolbarIcon
          icon={paused ? 'play' : 'pause'}
          title={t(paused ? 'resume' : 'pause')}
          onClick={() => {
            if (paused) {
              main.resumeLogcat(logcatIdRef.current)
            } else {
              main.pauseLogcat(logcatIdRef.current)
            }
            setPaused(!paused)
          }}
          disabled={!device}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="delete"
          title={t('clear')}
          onClick={clear}
          disabled={!device}
        />
      </LunaToolbar>
      {search.error && (
        <div className={Style.searchError} id={searchErrorId} role="status">
          {t('invalidLogSearchRegex')}
        </div>
      )}
      <LunaLogcat
        key={
          search.expression
            ? `${search.expression.pattern()}/${search.expression.flags()}`
            : ''
        }
        className={Style.body}
        maxNum={MAX_LOG_ENTRIES}
        filter={filter}
        wrapLongLines={softWrap}
        onContextMenu={onContextMenu}
        view={view}
        onCreate={(logcat) => {
          logcatRef.current = logcat
          const stopHighlight = highlightLogcat(
            logcat.container,
            search.expression
          )
          logcat.on('destroy', () => {
            stopHighlight()
            if (logcatRef.current === logcat) {
              logcatRef.current = null
            }
          })
          // Rebuild only the viewer when searching; keep the original entries
          // and the running ADB stream for save, pause and resume.
          for (const entry of getLogcatSearchEntries(
            entriesRef.current,
            search.expression,
            MAX_LOG_ENTRIES
          )) {
            logcat.append(entry)
          }
        }}
      />
    </div>
  )
})

function toLetter(priority: number) {
  return ['?', '?', 'V', 'D', 'I', 'W', 'E'][priority]
}
