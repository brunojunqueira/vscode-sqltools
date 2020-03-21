import { CompletionItem, CompletionItemKind, Range } from 'vscode-languageserver';
// import { TableCompletionItem, TableColumnCompletionItem, TableCompletionItemFirst } from './models';
import { ILanguageServerPlugin, ILanguageServer, DatabaseDriver, ContextValue, NSDatabase, Arg0 } from '@sqltools/types';
import { getDocumentCurrentQuery } from './query';
import connectionStateCache, { LAST_USED_ID_KEY, ACTIVE_CONNECTIONS_KEY } from '../connection-manager/cache/connections-state.model';
import { Parser } from 'node-sql-parser';
import Connection from '@sqltools/language-server/connection';
import { TableCompletionItem } from './models';
import logger from '@sqltools/util/log';
const log = logger.extend('intellisense');

const parser = new Parser();
const IS_WORD_REGEX = /^\w/g;
export default class IntellisensePlugin<T extends ILanguageServer> implements ILanguageServerPlugin<T> {
  private server: T;

  private onCompletion: Arg0<ILanguageServer['onCompletion']> = async params => {
    let completions: CompletionItem[] = [];
    try {
      const [ activeConnections, lastUsedId ] = await Promise.all<
        {[k: string]: Connection },
        string
      >([
        connectionStateCache.get(ACTIVE_CONNECTIONS_KEY, {}),
        connectionStateCache.get(LAST_USED_ID_KEY) as Promise<string>,
      ])
      const { textDocument, position } = params;
      log.extend('info')('completion requested %O', position);
      const doc = this.server.docManager.get(textDocument.uri);

      const { currentQuery } = getDocumentCurrentQuery(doc, position);
      log.extend('debug')('got current query:\n%s', currentQuery);
      const prevWords = doc.getText(Range.create(Math.max(0, position.line - 5), 0, position.line, position.character)).replace(/[\r\n|\n]+/g, ' ').split(/;/g).pop().split(/\s+/g);
      const currentPrefix = (prevWords.pop() || '').toUpperCase();
      const prevWord = (prevWords.pop() || '').toUpperCase();
      log.extend('debug')('check prevword %s', prevWord);

      const conn = activeConnections[lastUsedId];
      let driver: string;

      let searchTablesPromise: Promise<NSDatabase.ITable[]> = Promise.resolve([]);
      let staticCompletionsPromise: ReturnType<typeof conn.getStaticCompletions> = Promise.resolve({});

      if (conn) {
        searchTablesPromise = conn.searchItems(ContextValue.TABLE, currentPrefix) as any;
        staticCompletionsPromise = conn.getStaticCompletions();
        switch (conn.getDriver()) {
          case DatabaseDriver['AWS Redshift']:
            driver = DatabaseDriver.PostgreSQL;
            break;
          case DatabaseDriver.MSSQL:
            driver = 'transactsql';
            break;
          case DatabaseDriver.MySQL:
          case DatabaseDriver.MariaDB:
            break;
          default:
            driver = null;
        }
      }
      const staticCompletions = await staticCompletionsPromise;

      try {
        const parsed = parser.parse(currentQuery, driver ? { database: driver } : undefined);
        log.extend('debug')('query ast parsed:\n%O', JSON.stringify(parsed));
        completions = Object.values(staticCompletions);
      } catch (error) {
        if (error.expected && error.expected.length > 0) {
          const added = {};
          error.expected.forEach(exp => {
            let label: string = null;
            if (exp.text) {
              label = exp.text;
            }
            if (label === null || added[label]) return;
            added[label] = true;
            completions.push(<CompletionItem>(staticCompletions[label] || {
              label,
              filterText: label,
              sortText: IS_WORD_REGEX.test(label) ? `3:${label}` : `4:${label}`,
              kind: CompletionItemKind[exp.type.charAt(0) + exp.type.substr(1)]
            }));
          })
        };
      }

      if (!conn) {
        log.extend('info')('no active connection completions count: %d', completions.length);
        return completions
      };

      switch (prevWord) {
        case 'FROM':
        case 'JOIN':
        case 'TABLE':
        case 'INTO':
              // suggest tables
          const tables = await searchTablesPromise;
          log.extend('info')('got %d table completions', tables.length);
          if (tables.length  > 0)
            completions.push(...tables.map(t => TableCompletionItem(t, 0)));
        default:
          break;
      }
    } catch (error) {
      console.error(error);
      log.extend('error')('got an error:\n %O', error);
    }
    log.extend('debug')('total completions %d', completions.length);
    return completions;
  }

  public register(server: T) {
    this.server = this.server || server;
    this.server.addOnInitializeHook(() => ({
      capabilities: {
        completionProvider: {
          workDoneProgress: true,
        },
      }
    }));

    this.server.onCompletion(this.onCompletion);
  }
}
