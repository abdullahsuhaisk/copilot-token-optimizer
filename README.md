# Enterprise AI Token Optimizer

A VS Code extension + MCP (Model Context Protocol) server that prunes and compresses text/file content going into Copilot/agent tools **before it reaches the LLM**. It strips unnecessary comments, whitespace, and repeated lines to reduce token usage, and reports the savings in real time via the status bar.

## Features

- **MCP server (stdio)** — exposes three tools: `optimize_context`, `read_file_optimized`, and `get_token_stats`.
- **Status bar telemetry** — shows the cumulative net token/credit change for complete tool replies, including the summary.
- **Estimated AI Credits savings** — estimates credits saved from input tokens using the configured model price (`aiTokenOptimizer.aiCreditInputPricePerMillionUsd`, default `$1/1M tokens`).
- **Detailed savings report command** — `AI Token Optimizer: Show Token Savings` separates payload savings from net savings across the complete textual MCP reply, including the summary line.
- **Safe file reads** — `read_file_optimized` rejects requests that escape the workspace root (path traversal).
- **Two optimization levels** — comment removal uses known language syntax; Markdown is preserved and unknown content is not guessed to be code. `aggressive` folds repeated spaces only for explicitly selected `plaintext`, preserving code and Markdown spacing.
- **Accurate reply accounting** — reports token growth as well as savings, and measures the complete textual tool reply (summary plus optimized content) separately from payload-only savings.
- **Sensitive data redaction** — secrets/API keys, passwords, private keys, IPv4/IPv6 and MAC addresses and e-mails are masked (`[REDACTED_SECRET]`, `[REDACTED_IPV4]`, …) before reaching the LLM; counts are shown in tool output, the status bar and the savings report.

## Architecture

```
src/
  extension.ts    -> VS Code extension entry point (status bar, command, MCP definition)
  mcp-server.ts   -> Standalone Node process running the MCP server (stdio transport)
  optimizer.ts    -> Pure, vscode-independent text/code pruning engine
  redactor.ts     -> Masks secrets, IP/MAC addresses and e-mails
  telemetry.ts    -> Helpers for reading/writing the shared stats file
```

When the extension activates, it launches `out/mcp-server.js` as a separate `node` process, passing it the `STATS_FILE` and `WORKSPACE_ROOT` environment variables. When the agent calls an MCP tool, the server runs the text through `optimize()` and returns the optimized result; the savings are written to the shared stats file, which the extension watches to refresh the status bar.

## Requirements

- Node.js `>= 20`
- VS Code `^1.99.0`
- npm

## Setup

```bash
git clone <repo-url>
cd performanceProject2026
npm install
```

## Running Locally

1. **Build**

   ```bash
   npm run compile
   ```

   To rebuild automatically on changes during development:

   ```bash
   npm run watch
   ```

   (This can also be run in the background via the `npm: watch` task defined in `tasks.json`.)

2. **Run the extension in the Extension Development Host**

   - Open the project in VS Code.
   - Press `F5` (or select "Run Extension" from the Run and Debug panel).
   - A new VS Code window (Extension Development Host) opens with the extension loaded.
   - You should see `$(zap) Saved ... tokens` in the bottom-right status bar.
   - Run **"AI Token Optimizer: Show Token Savings"** from the command palette (`Cmd+Shift+P`) to see the detailed savings report.

3. **Using the MCP server from an agent**

   Once active, the extension automatically registers the MCP server with VS Code's `mcpServerDefinitionProviders` mechanism; `optimize_context`, `read_file_optimized`, and `get_token_stats` become available in Copilot Chat/agent mode with no extra configuration.

4. **Running tests**

   ```bash
   npm test
   ```

   To run in watch mode during development:

   ```bash
   npm run test:watch
   ```

5. **Linting**

   ```bash
   npm run lint
   ```

## Available Scripts

| Command               | Description                                       |
| --------------------- | -------------------------------------------------- |
| `npm run compile`      | Compiles TypeScript sources into `out/`.           |
| `npm run watch`        | Continuously rebuilds on file changes.             |
| `npm run lint`         | Runs ESLint on the `src` folder.                   |
| `npm test`             | Runs the Vitest unit tests once.                   |
| `npm run test:watch`   | Runs Vitest in watch mode.                         |
| `npm run pretest`      | Compile + lint (runs automatically before tests).  |

## Commands

- `AI Token Optimizer: Show Token Savings` — shows raw/optimized token counts and the saved percentage for the current session in an output panel.

## Making Copilot Use the Tools

The model decides which tool to call, so an extension cannot force it. To maximize usage:

1. **Disable the built-in file-read tool** in Agent mode via the **Tools** picker in the chat input; Copilot then has to use `read_file_optimized`.
2. **Add project instructions for extra savings:** create `.github/copilot-instructions.md` in the root of your project with the content below. Copilot reads it automatically on every request in that workspace:

```markdown
# Copilot Instructions — AI Token Optimizer

- ALWAYS read workspace files with the `read_file_optimized` MCP tool (from the
  "AI Token Optimizer" server). Do NOT use the built-in file-read tool unless
  `read_file_optimized` returns an error, or you need the exact original text
  and line numbers to make an edit.
- Before reasoning over any large text that is not a file (terminal output,
  logs, pasted code, API responses), pass it through the `optimize_context`
  MCP tool first.
- When the user asks about savings, call `get_token_stats`.
```

3. **Reference the tool explicitly** in a prompt, e.g. `#read_file_optimized`.

## Known Limitations

- Optimization only happens at the MCP tool-output boundary; VS Code currently has no API to transparently rewrite Copilot's own prompt, so the model's direct input cannot be altered.
- AI Credits are an estimate based on uncached input-token price, not Copilot billing data. Set `aiTokenOptimizer.aiCreditInputPricePerMillionUsd` to the input price for your model; actual usage can differ due to model choice and cached tokens.
- Stats are stored in `stats.json` inside the extension's global storage directory, shared by all VS Code windows, and show the cumulative total across projects. Complete-reply measurements start with calls after this update; older records remain in payload-only totals because they did not store the reply summary.

## Use with Claude Code, Claude Desktop, Cursor, and other MCP clients

The MCP server uses the standard local `stdio` transport, so it can also run from MCP clients other than VS Code. No VS Code extension is needed in those clients.

1. Clone this repository and build the server:

   ```bash
   npm install
   npm run compile
   ```

   Use Node.js 20 or later. Keep the clone and its `node_modules` directory available; the client starts `out/mcp-server.js` directly.

2. Set the server script path to the absolute path of this clone, and set `WORKSPACE_ROOT` to the project whose files the AI should read. `read_file_optimized` is restricted to that workspace root. `STATS_FILE` is optional; configure it to a writable file path if you also want to persist and view savings across clients.

### Claude Code

From the project directory you want Claude Code to work in, run this command after replacing both example paths:

```bash
claude mcp add --transport stdio --scope local \
  --env "WORKSPACE_ROOT=/absolute/path/to/your/project" \
  --env "STATS_FILE=/absolute/path/to/your/project/.ai-token-optimizer-stats.json" \
  ai-token-optimizer -- node /absolute/path/to/copilot-token-optimizer/out/mcp-server.js
```

### Claude Desktop and Cursor

Add the following entry to the `mcpServers` object in the client's MCP configuration. Replace the example paths with absolute paths. For Claude Desktop, open **Settings → Developer → Edit Config**; for Cursor, add it to `.cursor/mcp.json` in your project. If the file already has an `mcpServers` object, add only the `ai-token-optimizer` entry rather than replacing the existing servers.

```json
{
  "mcpServers": {
    "ai-token-optimizer": {
      "command": "node",
      "args": ["/absolute/path/to/copilot-token-optimizer/out/mcp-server.js"],
      "env": {
        "WORKSPACE_ROOT": "/absolute/path/to/your/project",
        "STATS_FILE": "/absolute/path/to/your/project/.ai-token-optimizer-stats.json"
      }
    }
  }
}
```

Restart or reload the client after saving its configuration. The three tools (`optimize_context`, `read_file_optimized`, and `get_token_stats`) will then be available. Omit `STATS_FILE` if you do not need persistent savings statistics.

## License

MIT

---

# Enterprise AI Token Optimizer (Türkçe)

VS Code eklentisi + MCP (Model Context Protocol) sunucusu olarak çalışan, Copilot/agent araçlarına giden metin ve dosya içeriklerini **LLM'e ulaşmadan önce** budayıp sıkıştıran bir context yöneticisi. Gereksiz yorumları, boşlukları ve tekrar eden satırları temizleyerek token tüketimini azaltır ve kazanımları gerçek zamanlı olarak status bar üzerinde gösterir.

## Özellikler

- **MCP sunucusu (stdio)** — `optimize_context`, `read_file_optimized` ve `get_token_stats` adında üç araç sunar.
- **Durum çubuğu telemetrisi** — Özet satırı dâhil tam araç yanıtlarının birikimli net token/kredi değişimini gösterir.
- **Tahmini AI Credits tasarrufu** — Kaydedilen giriş tokenlarını, yapılandırılan model fiyatına göre AI kredisine dönüştürür (`aiTokenOptimizer.aiCreditInputPricePerMillionUsd`, varsayılan `$1/1M token`).
- **Detaylı rapor komutu** — `AI Token Optimizer: Show Token Savings`, içerik tasarrufunu özet satırı dâhil tam MCP yanıtının net tasarrufundan ayrı gösterir.
- **Güvenli dosya okuma** — `read_file_optimized` aracı, çalışma alanı kökü dışına çıkan (path traversal) istekleri reddeder.
- **İki seviyeli optimizasyon** — yorumlar yalnızca bilinen dil sözdizimine göre kaldırılır; Markdown korunur ve bilinmeyen içerik kod varsayılmaz. `aggressive`, kod ve Markdown boşluklarını korur; tekrar eden boşlukları yalnızca `plaintext` açıkça seçildiğinde daraltır.
- **Doğru yanıt ölçümü** — içerik tasarrufunun yanında token artışını da raporlar; özet satırı ve optimize edilmiş içerik dâhil tam metin yanıtını ayrı ölçer.
- **Hassas veri maskeleme** — secret/API anahtarları, şifreler, private key'ler, IPv4/IPv6 ve MAC adresleri ile e-postalar LLM'e ulaşmadan maskelenir (`[REDACTED_SECRET]`, `[REDACTED_IPV4]`, …); sayılar araç çıktısında, durum çubuğunda ve tasarruf raporunda gösterilir.

## Mimari

```
src/
  extension.ts    -> VS Code eklenti giriş noktası (status bar, komut, MCP tanımı)
  mcp-server.ts   -> Bağımsız Node süreci olarak çalışan MCP sunucusu (stdio transport)
  optimizer.ts    -> Saf, vscode bağımsız metin/kod budama motoru
  redactor.ts     -> Secret, IP/MAC adresi ve e-postaları maskeler
  telemetry.ts    -> Paylaşılan istatistik dosyasını okuma/yazma yardımcıları
```

Eklenti aktive olduğunda `out/mcp-server.js` dosyasını `node` ile ayrı bir süreç olarak başlatır ve ona `STATS_FILE` ile `WORKSPACE_ROOT` ortam değişkenlerini geçer. Agent bir MCP aracını çağırdığında sunucu, metni `optimize()` fonksiyonundan geçirip optimize edilmiş sonucu döndürür; kazanım bilgisi paylaşılan istatistik dosyasına yazılır ve eklenti bu dosyayı izleyerek durum çubuğunu günceller.

## Gereksinimler

- Node.js `>= 20`
- VS Code `^1.99.0`
- npm

## Kurulum

```bash
git clone <repo-url>
cd performanceProject2026
npm install
```

## Projeyi Localde Çalıştırma

1. **Derleme**

   ```bash
   npm run compile
   ```

   Geliştirme sırasında değişiklikleri otomatik derlemek için:

   ```bash
   npm run watch
   ```

   (Bu komut `tasks.json` üzerinden tanımlı `npm: watch` görevi olarak da arka planda çalıştırılabilir.)

2. **Eklentiyi Extension Development Host ile çalıştırma**

   - VS Code'da projeyi açın.
   - `F5` tuşuna basın (veya "Run and Debug" panelinden "Run Extension" seçin).
   - Açılan yeni VS Code penceresi (Extension Development Host) eklentiyi yüklü olarak başlatır.
   - Sağ alt köşedeki durum çubuğunda `$(zap) Saved ... tokens` ibaresini görmelisiniz.
   - Komut paletinden (`Cmd+Shift+P`) **"AI Token Optimizer: Show Token Savings"** komutunu çalıştırarak detaylı kazanım raporunu görebilirsiniz.

3. **MCP sunucusunun agent tarafından kullanılması**

   Eklenti aktif olduğunda MCP sunucusunu VS Code'un `mcpServerDefinitionProviders` mekanizmasına otomatik olarak kaydeder; Copilot Chat/agent modunda ek bir yapılandırma gerekmeden `optimize_context`, `read_file_optimized` ve `get_token_stats` araçları kullanılabilir hale gelir.

4. **Testleri çalıştırma**

   ```bash
   npm test
   ```

   Geliştirme sırasında izleme modunda çalıştırmak için:

   ```bash
   npm run test:watch
   ```

5. **Lint kontrolü**

   ```bash
   npm run lint
   ```

## Kullanılabilir Script'ler

| Komut                 | Açıklama                                             |
| --------------------- | ----------------------------------------------------- |
| `npm run compile`      | TypeScript kaynaklarını `out/` dizinine derler.        |
| `npm run watch`        | Değişiklikleri izleyerek sürekli derleme yapar.        |
| `npm run lint`         | `src` klasöründe ESLint kontrolü çalıştırır.           |
| `npm test`             | Vitest ile birim testlerini tek seferlik çalıştırır.   |
| `npm run test:watch`   | Vitest'i izleme modunda çalıştırır.                    |
| `npm run pretest`      | Derleme + lint (test öncesi otomatik çalışır).         |

## Komutlar

- `AI Token Optimizer: Show Token Savings` — Mevcut oturumun ham/optimize token sayılarını ve kazanım yüzdesini çıktı panelinde gösterir.

## Copilot'un Araçları Kullanmasını Sağlama

Hangi aracın çağrılacağına model karar verir; eklenti bunu zorlayamaz. Kullanımı artırmak için:

1. **Yerleşik dosya okuma aracını kapatın:** Agent modunda chat kutusundaki **Tools** seçicisinden kaldırın; Copilot `read_file_optimized` kullanmak zorunda kalır.
2. **Daha fazla tasarruf için proje talimatı ekleyin:** Projenizin kök dizininde `.github/copilot-instructions.md` dosyasını oluşturup aşağıdaki içeriği yapıştırın. Copilot bu dosyayı o workspace'teki her istekte otomatik okur:

```markdown
# Copilot Instructions — AI Token Optimizer

- ALWAYS read workspace files with the `read_file_optimized` MCP tool (from the
  "AI Token Optimizer" server). Do NOT use the built-in file-read tool unless
  `read_file_optimized` returns an error, or you need the exact original text
  and line numbers to make an edit.
- Before reasoning over any large text that is not a file (terminal output,
  logs, pasted code, API responses), pass it through the `optimize_context`
  MCP tool first.
- When the user asks about savings, call `get_token_stats`.
```

3. **Aracı prompt'ta doğrudan belirtin**, örn. `#read_file_optimized`.

## Bilinen Sınırlamalar

- Optimizasyon yalnızca MCP araç çıktısı seviyesinde uygulanır; VS Code şu an Copilot'un kendi prompt'unu şeffaf biçimde yeniden yazmak için bir API sunmadığından, doğrudan model girişini değiştirmek mümkün değildir.
- AI Credits değeri, önbelleksiz giriş-token fiyatına dayalı bir tahmindir; Copilot fatura verisi değildir. `aiTokenOptimizer.aiCreditInputPricePerMillionUsd` ayarını kullandığınız modelin giriş-token fiyatına göre düzenleyin; model ve önbellek kullanımı gerçek tutarı değiştirebilir.
- İstatistikler, eklentinin global storage dizinindeki `stats.json` dosyasında saklanır; tüm VS Code pencereleri bu dosyayı paylaşır ve projeler genelindeki toplamı gösterir. Tam yanıt ölçümleri bu güncellemeden sonraki çağrılarla başlar; eski kayıtlar yanıt özetini içermediğinden içerik ölçümü olarak korunur.

## Claude Code, Claude Desktop, Cursor ve diğer MCP istemcilerinde kullanım

MCP sunucusu standart yerel `stdio` aktarımını kullanır; bu nedenle VS Code dışındaki MCP istemcilerinde de çalışır. Bu istemcilerde VS Code eklentisine gerek yoktur.

1. Bu depoyu klonlayıp sunucuyu derleyin:

   ```bash
   npm install
   npm run compile
   ```

   Node.js 20 veya üzeri gereklidir. Klonu ve `node_modules` dizinini erişilebilir tutun; istemci doğrudan `out/mcp-server.js` dosyasını başlatır.

2. Sunucu betiği için klonun mutlak yolunu, `WORKSPACE_ROOT` için de AI'ın okuyacağı projenin kök dizinini kullanın. `read_file_optimized` yalnızca bu kök dizin içindeki dosyalara erişebilir. Tasarruf istatistiklerini istemciler arasında saklamak ve görüntülemek için isteğe bağlı `STATS_FILE` değerini yazılabilir bir dosya yoluna ayarlayın.

### Claude Code

Claude Code'un çalışacağı proje dizininde, örnek yolları kendi mutlak yollarınızla değiştirerek şu komutu çalıştırın:

```bash
claude mcp add --transport stdio --scope local \
  --env "WORKSPACE_ROOT=/mutlak/yol/projeniz" \
  --env "STATS_FILE=/mutlak/yol/projeniz/.ai-token-optimizer-stats.json" \
  ai-token-optimizer -- node /mutlak/yol/copilot-token-optimizer/out/mcp-server.js
```

### Claude Desktop ve Cursor

İstemcinin MCP yapılandırmasındaki `mcpServers` nesnesine aşağıdaki girdiyi ekleyin ve örnek yolları mutlak yollarınızla değiştirin. Claude Desktop'ta **Settings → Developer → Edit Config** yolunu izleyin; Cursor'da projenizdeki `.cursor/mcp.json` dosyasına ekleyin. Dosyada zaten bir `mcpServers` nesnesi varsa diğer sunucuları silmek yerine yalnızca `ai-token-optimizer` girdisini ekleyin.

```json
{
  "mcpServers": {
    "ai-token-optimizer": {
      "command": "node",
      "args": ["/mutlak/yol/copilot-token-optimizer/out/mcp-server.js"],
      "env": {
        "WORKSPACE_ROOT": "/mutlak/yol/projeniz",
        "STATS_FILE": "/mutlak/yol/projeniz/.ai-token-optimizer-stats.json"
      }
    }
  }
}
```

Yapılandırmayı kaydettikten sonra istemciyi yeniden başlatın veya MCP sunucularını yeniden yükleyin. Üç araç (`optimize_context`, `read_file_optimized` ve `get_token_stats`) kullanılabilir hale gelir. Kalıcı tasarruf istatistiklerine ihtiyacınız yoksa `STATS_FILE` ayarını kaldırabilirsiniz.

## Lisans

MIT

---

# Enterprise AI Token Optimizer (Italiano)

Estensione VS Code + server MCP (Model Context Protocol) che riduce e comprime il testo e il contenuto dei file inviati agli strumenti Copilot/agent **prima che raggiungano l'LLM**. Rimuove commenti superflui, spazi e righe ripetute per ridurre il consumo di token e mostra il risparmio in tempo reale nella barra di stato.

## Funzionalità

- **Server MCP (stdio)** — espone tre strumenti: `optimize_context`, `read_file_optimized` e `get_token_stats`.
- **Telemetria nella barra di stato** — mostra la variazione netta cumulativa di token/crediti delle risposte complete, inclusa la riga di riepilogo.
- **Risparmio stimato di AI Credits** — stima i crediti risparmiati dai token di input usando il prezzo del modello configurato (`aiTokenOptimizer.aiCreditInputPricePerMillionUsd`, predefinito `$1/1M token`).
- **Comando di report dettagliato** — `AI Token Optimizer: Show Token Savings` distingue il risparmio del contenuto dal risparmio netto dell'intera risposta MCP testuale, inclusa la riga di riepilogo.
- **Lettura sicura dei file** — `read_file_optimized` rifiuta le richieste che escono dalla radice del workspace (path traversal).
- **Due livelli di ottimizzazione** — i commenti vengono rimossi solo usando la sintassi nota del linguaggio; Markdown viene preservato e il contenuto sconosciuto non viene interpretato come codice. `aggressive` riduce gli spazi ripetuti solo per `plaintext` selezionato esplicitamente, preservando codice e Markdown.
- **Misurazione accurata delle risposte** — rileva anche l'aumento di token e misura separatamente l'intero testo della risposta MCP (riepilogo e contenuto ottimizzato) dal solo contenuto.
- **Oscuramento dei dati sensibili** — segreti/chiavi API, password, chiavi private, indirizzi IPv4/IPv6 e MAC ed e-mail vengono mascherati (`[REDACTED_SECRET]`, `[REDACTED_IPV4]`, …) prima di raggiungere l'LLM; i conteggi sono mostrati nell'output degli strumenti, nella barra di stato e nel report dei risparmi.

## Architettura

```
src/
  extension.ts    -> Punto di ingresso dell'estensione VS Code (barra di stato, comando, definizione MCP)
  mcp-server.ts   -> Processo Node autonomo che esegue il server MCP (trasporto stdio)
  optimizer.ts    -> Motore puro di potatura testo/codice, indipendente da vscode
  redactor.ts     -> Maschera segreti, indirizzi IP/MAC ed e-mail
  telemetry.ts    -> Funzioni di lettura/scrittura del file di statistiche condiviso
```

Quando l'estensione si attiva, avvia `out/mcp-server.js` come processo separato (usando il runtime Node incorporato in VS Code, quindi non serve `node` nel PATH) e gli passa le variabili d'ambiente `STATS_FILE` e `WORKSPACE_ROOT`. Quando l'agent chiama uno strumento MCP, il server elabora il testo con `optimize()` e restituisce il risultato ottimizzato; il risparmio viene scritto nel file di statistiche condiviso, che l'estensione monitora per aggiornare la barra di stato.

## Requisiti

- Node.js `>= 20`
- VS Code `^1.99.0`
- npm

## Installazione

```bash
git clone <repo-url>
cd performanceProject2026
npm install
```

## Esecuzione in locale

1. **Compilazione**

   ```bash
   npm run compile
   ```

   Per ricompilare automaticamente durante lo sviluppo:

   ```bash
   npm run watch
   ```

   (Può essere eseguito anche in background tramite il task `npm: watch` definito in `tasks.json`.)

2. **Eseguire l'estensione nell'Extension Development Host**

   - Apri il progetto in VS Code.
   - Premi `F5` (oppure seleziona "Run Extension" dal pannello Run and Debug).
   - Si apre una nuova finestra di VS Code (Extension Development Host) con l'estensione caricata.
   - Dovresti vedere `$(zap) Saved ... tokens` nella barra di stato in basso a destra.
   - Esegui **"AI Token Optimizer: Show Token Savings"** dalla riga di comando (`Cmd+Shift+P`) per vedere il report dettagliato.

3. **Uso del server MCP da parte di un agent**

   Una volta attiva, l'estensione registra automaticamente il server MCP tramite il meccanismo `mcpServerDefinitionProviders` di VS Code; `optimize_context`, `read_file_optimized` e `get_token_stats` diventano disponibili in Copilot Chat/modalità agent senza ulteriore configurazione.

4. **Esecuzione dei test**

   ```bash
   npm test
   ```

   Per eseguirli in modalità watch durante lo sviluppo:

   ```bash
   npm run test:watch
   ```

5. **Linting**

   ```bash
   npm run lint
   ```

## Script disponibili

| Comando               | Descrizione                                           |
| --------------------- | ------------------------------------------------------ |
| `npm run compile`      | Compila i sorgenti TypeScript in `out/`.               |
| `npm run watch`        | Ricompila continuamente a ogni modifica.               |
| `npm run lint`         | Esegue ESLint sulla cartella `src`.                    |
| `npm test`             | Esegue i test unitari Vitest una volta.                |
| `npm run test:watch`   | Esegue Vitest in modalità watch.                       |
| `npm run pretest`      | Compilazione + lint (eseguito automaticamente prima dei test). |

## Comandi

- `AI Token Optimizer: Show Token Savings` — mostra in un pannello di output i token grezzi/ottimizzati e la percentuale di risparmio della sessione corrente.

## Far usare gli strumenti a Copilot

È il modello a decidere quale strumento chiamare, quindi un'estensione non può forzarlo. Per massimizzarne l'uso:

1. **Disattiva lo strumento integrato di lettura file** in modalità Agent dal selettore **Tools** nella chat; Copilot dovrà usare `read_file_optimized`.
2. **Aggiungi istruzioni di progetto per un risparmio maggiore:** crea `.github/copilot-instructions.md` nella root del progetto con il contenuto seguente. Copilot lo legge automaticamente a ogni richiesta in quel workspace:

```markdown
# Copilot Instructions — AI Token Optimizer

- ALWAYS read workspace files with the `read_file_optimized` MCP tool (from the
  "AI Token Optimizer" server). Do NOT use the built-in file-read tool unless
  `read_file_optimized` returns an error, or you need the exact original text
  and line numbers to make an edit.
- Before reasoning over any large text that is not a file (terminal output,
  logs, pasted code, API responses), pass it through the `optimize_context`
  MCP tool first.
- When the user asks about savings, call `get_token_stats`.
```

3. **Cita lo strumento esplicitamente** nel prompt, ad es. `#read_file_optimized`.

## Limitazioni note

- L'ottimizzazione avviene solo al confine dell'output degli strumenti MCP; VS Code al momento non offre un'API per riscrivere in modo trasparente il prompt di Copilot, quindi l'input diretto del modello non può essere modificato.
- Gli AI Credits sono una stima basata sul prezzo dei token di input non memorizzati nella cache, non sui dati di fatturazione Copilot. Imposta `aiTokenOptimizer.aiCreditInputPricePerMillionUsd` in base al prezzo del modello; il modello e i token nella cache possono modificare il consumo effettivo.
- Le statistiche sono salvate in `stats.json` nella directory di global storage dell'estensione, sono condivise da tutte le finestre di VS Code e mostrano il totale cumulativo tra i progetti. Le misurazioni della risposta completa iniziano con le chiamate dopo questo aggiornamento; i dati precedenti restano nei totali del solo contenuto perché non includevano il riepilogo della risposta.

## Utilizzo con Claude Code, Claude Desktop, Cursor e altri client MCP

Il server MCP usa il trasporto locale standard `stdio`, quindi può essere avviato anche da client MCP diversi da VS Code. In questi client non è necessaria l'estensione VS Code.

1. Clona questo repository e compila il server:

   ```bash
   npm install
   npm run compile
   ```

   È richiesto Node.js 20 o successivo. Mantieni accessibili il clone e la directory `node_modules`; il client avvia direttamente `out/mcp-server.js`.

2. Imposta il percorso assoluto dello script del server e usa `WORKSPACE_ROOT` per indicare il progetto di cui l'AI può leggere i file. `read_file_optimized` è limitato a questa directory principale. `STATS_FILE` è facoltativo; impostalo su un percorso scrivibile per salvare e consultare le statistiche di risparmio tra client diversi.

### Claude Code

Dalla directory del progetto su cui deve lavorare Claude Code, esegui il comando seguente sostituendo entrambi i percorsi di esempio:

```bash
claude mcp add --transport stdio --scope local \
  --env "WORKSPACE_ROOT=/percorso/assoluto/del/progetto" \
  --env "STATS_FILE=/percorso/assoluto/del/progetto/.ai-token-optimizer-stats.json" \
  ai-token-optimizer -- node /percorso/assoluto/copilot-token-optimizer/out/mcp-server.js
```

### Claude Desktop e Cursor

Aggiungi la seguente voce all'oggetto `mcpServers` nella configurazione MCP del client e sostituisci i percorsi di esempio con percorsi assoluti. In Claude Desktop, apri **Settings → Developer → Edit Config**; in Cursor, aggiungila al file `.cursor/mcp.json` del progetto. Se esiste già un oggetto `mcpServers`, aggiungi solo la voce `ai-token-optimizer`, senza sostituire gli altri server.

```json
{
  "mcpServers": {
    "ai-token-optimizer": {
      "command": "node",
      "args": ["/percorso/assoluto/copilot-token-optimizer/out/mcp-server.js"],
      "env": {
        "WORKSPACE_ROOT": "/percorso/assoluto/del/progetto",
        "STATS_FILE": "/percorso/assoluto/del/progetto/.ai-token-optimizer-stats.json"
      }
    }
  }
}
```

Dopo aver salvato la configurazione, riavvia il client o ricarica i server MCP. Saranno disponibili i tre strumenti (`optimize_context`, `read_file_optimized` e `get_token_stats`). Ometti `STATS_FILE` se non ti serve salvare statistiche persistenti.

## Licenza

MIT

