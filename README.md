# Enterprise AI Token Optimizer

A VS Code extension + MCP (Model Context Protocol) server that prunes and compresses text/file content going into Copilot/agent tools **before it reaches the LLM**. It strips unnecessary comments, whitespace, and repeated lines to reduce token usage, and reports the savings in real time via the status bar.

## Features

- **MCP server (stdio)** — exposes three tools: `optimize_context`, `read_file_optimized`, and `get_token_stats`.
- **Status bar telemetry** — shows cumulative tokens saved for the session live (`$(zap) Saved N tokens`).
- **Detailed savings report command** — `AI Token Optimizer: Show Token Savings` lists raw/optimized token counts and the saved percentage in an output panel.
- **Safe file reads** — `read_file_optimized` rejects requests that escape the workspace root (path traversal).
- **Two optimization levels** — `conservative` (strips comments/whitespace without changing meaning) and `aggressive`.
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

## Known Limitations

- Optimization only happens at the MCP tool-output boundary; VS Code currently has no API to transparently rewrite Copilot's own prompt, so the model's direct input cannot be altered.
- Stats are stored in `stats.json` inside the extension's global storage directory and are scoped to the session.

## License

MIT

---

# Enterprise AI Token Optimizer (Türkçe)

VS Code eklentisi + MCP (Model Context Protocol) sunucusu olarak çalışan, Copilot/agent araçlarına giden metin ve dosya içeriklerini **LLM'e ulaşmadan önce** budayıp sıkıştıran bir context yöneticisi. Gereksiz yorumları, boşlukları ve tekrar eden satırları temizleyerek token tüketimini azaltır ve kazanımları gerçek zamanlı olarak status bar üzerinde gösterir.

## Özellikler

- **MCP sunucusu (stdio)** — `optimize_context`, `read_file_optimized` ve `get_token_stats` adında üç araç sunar.
- **Durum çubuğu telemetrisi** — Oturum boyunca kazanılan token sayısını canlı olarak gösterir (`$(zap) Saved N tokens`).
- **Detaylı rapor komutu** — `AI Token Optimizer: Show Token Savings` komutu, ham/optimize edilmiş token sayıları ve kazanım yüzdesini bir çıktı panelinde listeler.
- **Güvenli dosya okuma** — `read_file_optimized` aracı, çalışma alanı kökü dışına çıkan (path traversal) istekleri reddeder.
- **İki seviyeli optimizasyon** — `conservative` (anlamı değiştirmeden yorum/boşluk temizliği) ve `aggressive` seviyeleri desteklenir.
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

## Bilinen Sınırlamalar

- Optimizasyon yalnızca MCP araç çıktısı seviyesinde uygulanır; VS Code şu an Copilot'un kendi prompt'unu şeffaf biçimde yeniden yazmak için bir API sunmadığından, doğrudan model girişini değiştirmek mümkün değildir.
- İstatistikler, eklentinin global storage dizinindeki `stats.json` dosyasında saklanır ve oturuma özeldir.

## Lisans

MIT

