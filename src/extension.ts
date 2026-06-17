// extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as https from 'https';
import * as os from 'os';

// ==================== 更新提示配置 ====================
const SHOW_CHANGELOG_ON_NEXT_START_KEY = 'mbsim.showChangelogOnNextStart';
const LAST_SHOWN_CHANGELOG_VERSION_KEY = 'mbsim.lastShownChangelogVersion';

// 更新日志内容 - 每次发布新版本时修改这里
const CURRENT_CHANGELOG = `## 🎉 MBDyn Language Support 更新内容

v1.1.5
**新增功能：**
• 支持 URDF 文件交叉引用验证
• 新增柔性体碰撞检测参数补全
• 扩展版本，下载安装功能

**改进：**
• 悬停提示现在显示参数文档
• 自动补全支持更多参数选项

**修复：**
• 修复 CONSTRAINT 定义收集问题
• 修复中文字符检测误报

v1.1.6
**改进：**
• 增加 BEAMELE 的 NODES 多参数的交叉引用
• 关键词悬停提示增加所有约束、截面类型、几何类型等

v1.1.7
• 增加 README

v1.1.8
**新增功能：**
• 新增 INPUT TYPE 选项 LOCK_FREE（锁定-释放约束切换）
• 新增 INPUT TYPE 选项 TIME_STEP（变时间步长输入）
• 新增折叠区域支持：使用 !<-! 和 !->! 标记可折叠区域，默认折叠状态，保留前三行预览
• 新增 CLAUDE.md 项目文档，便于 AI 辅助开发

**改进：**
• LOCK_FREE、TIME_STEP 的 INIT_VAL/PAR_NUM 自动补全支持预设值
• TextMate 语法高亮支持 LOCK_FREE、TIME_STEP 关键字

`
;

/**
 * 在扩展更新/安装后调用，设置标志让下次启动时显示日志
 */

async function flagChangelogForNextStart(context: vscode.ExtensionContext): Promise<void> {
  await context.globalState.update(SHOW_CHANGELOG_ON_NEXT_START_KEY, true);
  console.log('[MBSim] Flagged to show changelog on next start');
}

/**
 * 检查是否需要显示更新日志（在 activate 中调用）
 */
async function showChangelogIfFlagged(context: vscode.ExtensionContext): Promise<void> {
  const shouldShow = context.globalState.get<boolean>(SHOW_CHANGELOG_ON_NEXT_START_KEY, false);
  
  console.log(`[MBSim] Should show changelog: ${shouldShow}`);
  
  if (shouldShow) {
    // 立即清除标志，确保只显示一次
    await context.globalState.update(SHOW_CHANGELOG_ON_NEXT_START_KEY, false);
    
    const currentVersion = context.extension.packageJSON.version;
    
    const action = await vscode.window.showInformationMessage(
      `MBDyn Language Support 已更新到 v${currentVersion}`,
      '查看更新内容',
      '关闭'
    );
    
    if (action === '查看更新内容') {
      showChangelogWebview(context, currentVersion);
    }
    
    // 记录最后显示的版本（用于参考）
    await context.globalState.update(LAST_SHOWN_CHANGELOG_VERSION_KEY, currentVersion);
  }
}

/**
 * 显示更新日志 Webview
 */
function showChangelogWebview(context: vscode.ExtensionContext, version: string): void {
  const panel = vscode.window.createWebviewPanel(
    'mbsimChangelog',
    `MBDyn v${version} 更新日志`,
    vscode.ViewColumn.One,
    { enableScripts: false }
  );
  
  panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
          padding: 20px; 
          line-height: 1.6;
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
        }
        h2 { color: var(--vscode-textLink-foreground); border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
        ul { padding-left: 20px; }
        li { margin: 8px 0; }
        code { 
          background: var(--vscode-textCodeBlock-background); 
          padding: 2px 6px; 
          border-radius: 3px;
          font-family: "SF Mono", Monaco, "Courier New", monospace;
        }
        .highlight { background: var(--vscode-editor-inactiveSelectionBackground); padding: 10px; border-radius: 5px; margin: 10px 0; }
      </style>
    </head>
    <body>
      ${CURRENT_CHANGELOG.replace(/\n/g, '<br>').replace(/•/g, '&bull;')}
      <div class="highlight">
        <p>💡 <strong>提示：</strong> 可在命令面板中运行 <code>MBSim: 检查扩展更新</code> 手动检查更新</p>
      </div>
    </body>
    </html>
  `;
}



// ==================== 扩展自更新配置 ====================
const EXTENSION_REPO = 'xxjxxj288/MBDy_vscode';
const EXTENSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EXTENSION_LAST_CHECK_KEY = 'mbsim.extension.lastCheck';

// ==================== 扩展自更新工具 ====================

function extractVersionFromVsixFilename(filename: string): string | null {
  const match = filename.match(/mbsim-language-support-(\d+\.\d+\.\d+)\.vsix$/i);
  return match ? match[1] : null;
}

async function getExtensionLatestRelease(): Promise<{
  version: string;
  downloadUrl: string;
  filename: string;
} | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${EXTENSION_REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'VSCode-MBSIM-Extension',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const release = JSON.parse(data);
            const assets = release.assets || [];
            const vsixAsset = assets.find((asset: any) => asset.name && asset.name.endsWith('.vsix'));
            if (vsixAsset) {
              const version = extractVersionFromVsixFilename(vsixAsset.name);
              if (version) {
                resolve({ version, downloadUrl: vsixAsset.browser_download_url, filename: vsixAsset.name });
                return;
              }
            }
          }
          resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function checkExtensionUpdate(context: vscode.ExtensionContext, showNotification: boolean = false): Promise<void> {
  const config = vscode.workspace.getConfiguration('mbsim');
  if (!showNotification && !config.get<boolean>('extension.autoCheckUpdates', true)) return;

  const now = Date.now();
  const lastCheck = context.globalState.get<number>(EXTENSION_LAST_CHECK_KEY, 0);
  if (!showNotification && (now - lastCheck) < EXTENSION_CHECK_INTERVAL_MS) return;
  await context.globalState.update(EXTENSION_LAST_CHECK_KEY, now);

  const currentVersion = context.extension.packageJSON.version;
  const latest = await getExtensionLatestRelease();
  if (!latest) {
    if (showNotification) vscode.window.showWarningMessage('无法获取扩展更新信息');
    return;
  }
  if (latest.version === currentVersion) {
    if (showNotification) vscode.window.showInformationMessage(`MBSIM Language Support 已是最新版本 (v${currentVersion})`);
    return;
  }
  const action = await vscode.window.showInformationMessage(
    `MBSIM Language Support 有新版本可用！\n当前: v${currentVersion} → 最新: v${latest.version}`,
    '下载并安装', '稍后提醒'
  );
  if (action === '下载并安装') {
    await downloadAndInstallExtensionUpdate(latest.downloadUrl, latest.filename, latest.version, context);
  }
}

async function downloadAndInstallExtensionUpdate(
  downloadUrl: string, filename: string, version: string, context: vscode.ExtensionContext
): Promise<void> {
  const tempDir = path.join(os.tmpdir(), 'mbsim-extension-update');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, filename);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `正在下载 ${filename}...`,
    cancellable: false
  }, async (progress) => {
    return new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(tempPath);
      const download = (url: string) => {
        https.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            download(response.headers.location!); return;
          }
          if (response.statusCode !== 200) { reject(new Error(`下载失败: ${response.statusCode}`)); return; }
          const total = parseInt(response.headers['content-length'] || '0', 10);
          let received = 0;
          response.on('data', (chunk) => {
            received += chunk.length;
            if (total) progress.report({ message: `${((received/total)*100).toFixed(0)}%` });
          });
          response.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      };
      download(downloadUrl);
    });
  });

  const action = await vscode.window.showInformationMessage(`${filename} 下载完成，是否立即安装并重启？`, '立即安装', '稍后手动安装');
  if (action === '立即安装') {

    const isWindows = process.platform === 'win32';
    const terminal = vscode.window.createTerminal({ name: 'Install Extension', cwd: tempDir });
    await flagChangelogForNextStart(context);
    console.log('[MBSim] Changelog flagged for next start');
    if (isWindows) {
      const cmdPath = process.env.ComSpec || 'cmd.exe';
      const vscodeCli = `"${path.join(path.dirname(process.execPath), 'bin', 'code.cmd')}"`;
      const vsixPath = `"${tempPath}"`;
      terminal.sendText(`${cmdPath} /c ${vscodeCli} --install-extension ${vsixPath} --force`, true);
      terminal.show();
      
      setTimeout(async () => {
        const restart = await vscode.window.showInformationMessage('扩展安装完成，需要重启 VS Code 以应用更改', '立即重启', '稍后手动重启');
        if (restart === '立即重启') vscode.commands.executeCommand('workbench.action.reloadWindow');
      }, 3000);
    } else {
      const cliPath = `"${path.join(path.dirname(process.execPath), 'bin', 'code')}"`;
      terminal.sendText(`${cliPath} --install-extension "${tempPath}" --force`, true);
      terminal.show();
    }
  } else {
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(tempPath));
    vscode.window.showInformationMessage(`扩展包已保存到: ${tempDir}\n请在 VS Code 扩展面板中选择"从 VSIX 安装"`);
  }
}

// ==================== 交叉引用验证配置 ====================
const crossRefRules = [
  { keyword: 'RIGIDBODY', param: 'GEOMETRY', set: 'geometries', displayName: 'GEOMETRY' },
  { keyword: 'RIGIDBODY', param: 'MATERIAL', set: 'materials', displayName: 'MATERIAL' },
  { keyword: 'SECTION', param: 'MATERIAL', set: 'materials', displayName: 'MATERIAL' },
  { keyword: 'SHELLELE', param: 'LAYER', set: 'sections', displayName: 'LAYER(SECTION)' },
  { keyword: 'BEAMELE', param: 'NODES', set: 'fnodes', displayName: 'NODES', isMultiValue: true }, // 新增
  { keyword: 'BEAMELE', param: 'SECTION', set: 'sections', displayName: 'SECTION' },
  { keyword: 'CONSTRAINT', param: 'MARKER1', set: 'markers', displayName: 'MARKER1' },
  { keyword: 'CONSTRAINT', param: 'MARKER2', set: 'markers', displayName: 'MARKER2' },
  { keyword: 'CONSTRAINT', param: 'ACT_MARKER', set: 'markers', displayName: 'ACT_MARKER' },
  { keyword: 'CONSTRAINT', param: 'SLAVE_MARKER', set: 'markers', displayName: 'SLAVE_MARKER' },
  { keyword: 'CONSTRAINT', param: 'FNODE1', set: 'fnodes', displayName: 'FNODE1' },
  { keyword: 'CONSTRAINT', param: 'FNODE2', set: 'fnodes', displayName: 'FNODE2' },
  { keyword: 'CONSTRAINT', param: 'RIGIDBODY1', set: 'rigidbodies', displayName: 'RIGIDBODY1' },
  { keyword: 'CONSTRAINT', param: 'RIGIDBODY2', set: 'rigidbodies', displayName: 'RIGIDBODY2' },
  { keyword: 'MARKER', param: 'BODY_NAME', set: 'rigidbodies', displayName: 'BODY_NAME' },
  { keyword: 'INPUT', param: 'NAME', set: 'rigidbodies,constraints,fnodes', displayName: 'NAME', isMultiSet: true },
  { keyword: 'OUTPUT', param: 'NAME', set: 'rigidbodies,constraints,fnodes', displayName: 'NAME', isMultiSet: true },
];

// 定义集合存储 - 修复：添加 constraints
const definitionSets: Record<string, Set<string>> = {
  geometries: new Set<string>(),
  materials: new Set<string>(),
  sections: new Set<string>(),
  markers: new Set<string>(),
  fnodes: new Set<string>(),
  rigidbodies: new Set<string>(),
  constraints: new Set<string>(), // 修复：之前缺少这个
};

// 存储引用位置信息
interface RefLocation {
  keyword: string;
  param: string;
  value: string;
  line: number;
  start: number;
  end: number;
  type: 'crossRef' | 'chineseChar';
  message?: string;
}
const referenceLocations: RefLocation[] = [];

// ==================== 中文字符检测工具 ====================
const chineseCharRegex = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;

function findChineseChars(str: string): Array<{char: string, index: number}> {
  const results: Array<{char: string, index: number}> = [];
  for (let i = 0; i < str.length; i++) {
    if (chineseCharRegex.test(str[i])) results.push({ char: str[i], index: i });
  }
  return results;
}

// ==================== 版本管理配置 ====================
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const VERSION_CHECK_KEY = 'mbsim.lastVersionCheck';
const LOCAL_FILENAME_KEY = 'mbsim.localFilename';

async function getLatestFilenameFromGitHub(): Promise<string | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/xxjxxj288/MBdyn/releases/latest',
      method: 'GET',
      headers: { 'User-Agent': 'VSCode-MBSIM-Extension', 'Accept': 'application/vnd.github.v3+json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const release = JSON.parse(data);
            const assets = release.assets || [];
            const exeAsset = assets.find((asset: any) => asset.name && asset.name.endsWith('.exe'));
            if (exeAsset) { resolve(exeAsset.name); return; }
          }
          resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function checkForUpdates(context: vscode.ExtensionContext, showNotification: boolean = false): Promise<void> {
  const config = vscode.workspace.getConfiguration('mbsim');
  if (!showNotification && !config.get<boolean>('simulator.autoCheckUpdates', true)) return;
  const simulatorPath = config.get<string>('simulator.path', '');
  if (!simulatorPath) {
    if (showNotification) vscode.window.showWarningMessage('尚未配置仿真器路径，请先下载或配置MBDyn');
    return;
  }
  const now = Date.now();
  const lastCheck = context.globalState.get<number>(VERSION_CHECK_KEY, 0);
  if (!showNotification && (now - lastCheck) < CHECK_INTERVAL_MS) return;
  await context.globalState.update(VERSION_CHECK_KEY, now);
  const localFilename = path.basename(simulatorPath);
  const latestFilename = await getLatestFilenameFromGitHub();
  if (!latestFilename) {
    if (showNotification) vscode.window.showWarningMessage('无法获取最新版本信息，请检查网络连接');
    return;
  }
  if (localFilename !== latestFilename) {
    const action = await vscode.window.showInformationMessage(`发现新版本！\n当前版本: ${localFilename}\n最新版本: ${latestFilename}`, '立即更新', '忽略');
    if (action === '立即更新') vscode.commands.executeCommand('mbsim.downloadSimulator');
  } else if (showNotification) {
    vscode.window.showInformationMessage(`当前已是最新版本 (${localFilename})`);
  }
}

// ==================== URDF 解析工具（新方案：使用 VS Code API）====================

/**
 * 异步解析工作区中的所有 URDF 文件
 * 使用 vscode.workspace.findFiles 避免阻塞
 */
async function parseUrdfFilesAsync(): Promise<void> {
  try {
    // 使用 VS Code API 查找所有 .urdf 文件
    const urdfFiles = await vscode.workspace.findFiles('**/*.urdf', '**/node_modules/**', 100);
    
    for (const uri of urdfFiles) {
      try {
        // 使用 VS Code 文档读取 API，可以利用缓存
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();
        parseUrdfContent(content);
      } catch (err) {
        // 静默处理单个文件错误
        console.log(`Failed to parse URDF ${uri.fsPath}:`, err);
      }
    }
  } catch (err) {
    console.log('Failed to find URDF files:', err);
  }
}

/**
 * 同步解析 URDF 内容（用于已有文本内容）
 */
function parseUrdfContent(content: string): void {
  // 安全：确保 definitionSets 已初始化
  if (!definitionSets?.rigidbodies || !definitionSets?.constraints) {
    console.warn('definitionSets not initialized');
    return;
  }

  // 提取 link name -> rigidbodies
  const linkRegex = /<link[^>]*\s+name=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(content)) !== null) {
    definitionSets.rigidbodies.add(match[1]);
  }

  // 提取 joint name -> constraints
  const jointRegex = /<joint[^>]*\s+name=["']([^"']+)["'][^>]*>/gi;
  while ((match = jointRegex.exec(content)) !== null) {
    definitionSets.constraints.add(match[1]);
  }
}

// ==================== 定义收集器（修改为异步）====================
async function collectDefinitionsAsync(lines: string[]): Promise<void> {
  // 清空现有定义
  Object.values(definitionSets).forEach(set => set.clear());
  referenceLocations.length = 0;

  // 首先解析 URDF 文件（异步）
  await parseUrdfFilesAsync();

  // 然后解析当前文档中的定义
  for (const line of lines) {
    const match = line.match(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\/\d+\s*,\s*([^,\s][^,]*)\s*,/);
    if (!match) continue;
    const key = match[1].toUpperCase();
    const name = match[2].trim();
    
    if (key === 'GEOMETRY') definitionSets.geometries.add(name);
    else if (key === 'MATERIAL') definitionSets.materials.add(name);
    else if (key === 'SECTION') definitionSets.sections.add(name);
    else if (key === 'MARKER') definitionSets.markers.add(name);
    else if (key === 'FNODE') definitionSets.fnodes.add(name);
    else if (key === 'RIGIDBODY') definitionSets.rigidbodies.add(name);
    else if (key === 'CONSTRAINT') definitionSets.constraints.add(name);
  }
}

// 为了保持兼容性，保留同步版本（不解析 URDF）
function collectDefinitions(lines: string[]): void {
  Object.values(definitionSets).forEach(set => set.clear());
  referenceLocations.length = 0;

  for (const line of lines) {
    const match = line.match(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\/\d+\s*,\s*([^,\s][^,]*)\s*,/);
    if (!match) continue;
    const key = match[1].toUpperCase();
    const name = match[2].trim();
    
    if (key === 'GEOMETRY') definitionSets.geometries.add(name);
    else if (key === 'MATERIAL') definitionSets.materials.add(name);
    else if (key === 'SECTION') definitionSets.sections.add(name);
    else if (key === 'MARKER') definitionSets.markers.add(name);
    else if (key === 'FNODE') definitionSets.fnodes.add(name);
    else if (key === 'RIGIDBODY') definitionSets.rigidbodies.add(name);
    else if (key === 'CONSTRAINT') definitionSets.constraints.add(name);
  }
}

// ==================== 通用验证函数（增强多集合支持）====================
function validateCrossRef(
  keyword: string, paramName: string, paramValue: string,
  lineIdx: number, start: number, end: number, diagnostics: vscode.Diagnostic[]
) {
  const rule = crossRefRules.find(r => r.keyword === keyword && r.param === paramName);
  if (!rule || !paramValue) return;

  // 处理多值情况（逗号分隔）
  const isMultiValue = (rule as any).isMultiValue;
  const values = isMultiValue
    ? paramValue.split(',').map(v => v.trim()).filter(v => v.length > 0)
    : [paramValue];

  let searchStart = 0;  // ✅ 记录搜索起始位置

  for (const singleValue of values) {
    // ✅ 修复：从上次找到的位置之后开始搜索
    const valueIndex = paramValue.indexOf(singleValue, searchStart);
    if (valueIndex === -1) continue;
    
    const valueStart = start + valueIndex;
    const valueEnd = valueStart + singleValue.length;
    
    // ✅ 更新搜索位置，确保下次从这个值之后开始
    searchStart = valueIndex + singleValue.length;

    referenceLocations.push({
      keyword, param: paramName, value: singleValue,
      line: lineIdx, start: valueStart, end: valueEnd, type: 'crossRef'
    });

    // 处理多集合规则（INPUT/OUTPUT 的 NAME）
    if ((rule as any).isMultiSet && rule.set.includes(',')) {
      const sets = rule.set.split(',');
      const existsInAnySet = sets.some(setName => {
        const set = definitionSets[setName.trim()];
        return set && set.has(singleValue);
      });
      
      if (!existsInAnySet) {
        const display = rule.displayName || rule.param;
        const allAvailable = sets.flatMap(setName => {
          const set = definitionSets[setName.trim()];
          return set ? Array.from(set) : [];
        });
        
        let message = `${keyword} 引用的 ${display} "${singleValue}" 未定义`;
        if (allAvailable.length > 0) {
          message += `。可用的定义: ${allAvailable.slice(0, 10).join(', ')}${allAvailable.length > 10 ? '...' : ''}`;
        }
        
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(lineIdx, valueStart, lineIdx, valueEnd),
          message,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.code = 'undefined-reference';
        diagnostics.push(diagnostic);
      }
    } else {
      // 单集合规则
      const targetSet = definitionSets[rule.set];
      if (!targetSet) {
        console.warn(`Unknown set: ${rule.set}`);
        continue;
      }
      
      if (!targetSet.has(singleValue)) {
        const display = rule.displayName || rule.param;
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(lineIdx, valueStart, lineIdx, valueEnd),
          `${keyword} 引用的 ${display} "${singleValue}" 未定义`,
          vscode.DiagnosticSeverity.Error
        );
        diagnostic.code = 'undefined-reference';
        diagnostics.push(diagnostic);
      }
    }
  }
}

function validateChineseChars(
  line: string, lineIdx: number, baseOffset: number,
  context: string, diagnostics: vscode.Diagnostic[]
) {
  const chineseChars = findChineseChars(line);
  for (const { char, index } of chineseChars) {
    const absStart = baseOffset + index;
    const absEnd = absStart + 1;
    referenceLocations.push({
      keyword: context, param: 'chinese', value: char,
      line: lineIdx, start: absStart, end: absEnd,
      type: 'chineseChar',
      message: `检测到中文字符 "${char}"，MBDyn输入文件建议使用纯英文`
    });
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineIdx, absStart, lineIdx, absEnd),
      `检测到中文字符 "${char}"，MBDyn输入文件建议使用纯英文`,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.code = 'chinese-character';
    diagnostics.push(diagnostic);
  }
}

// ==================== MBSIM_SCHEMA 定义 ====================
const MBSIM_SCHEMA: { [key: string]: { description: string; params: string[]; typeOptions?: { [param: string]: string[] }; } } = {
  'RIGIDBODY': { description: '刚体定义', params: ['TYPE', 'QG', 'VG', 'MASS', 'INERTIAL', 'GEOMETRY', 'FIX', 'COLLIDE', 'MATERIAL', 'RADIUS', 'HEIGHT', 'ROU', 'X', 'Y', 'Z', 'OBJFILE', 'SPHERE_SWEPT', 'SAFE_MARGIN', 'SCALE', 'SCALING', 'COG'], typeOptions: { 'TYPE': ['GENERAL', 'CYLINDER', 'BOX', 'SPHERE', 'OBJ'] } },
  'GEOMETRY': { description: '几何体定义', params: ['TYPE', 'QR', 'SCALE', 'SCALING', 'RADIUS', 'LENGTHS', 'OBJFILE', 'COLOR', 'TEXTURE_FILE', 'TEXTURE_SCALE', 'BOT_CENTER', 'TOP_CENTER', 'SPHERE_SWEPT', 'SAFE_MARGIN'], typeOptions: { 'TYPE': ['SPHERE', 'BOX', 'CYLINDER', 'OBJ'] } },
  'FNODE': { description: '柔性节点', params: ['TYPE', 'QG', 'VG'], typeOptions: { 'TYPE': ['FNODE_R', 'FNODE_RQ', 'FNODEA_RD', 'FNODEA_RDD', 'FNODEA_RDDD', 'FNODEA_RQ', 'FNODEA_RDV'] } },
  'MATERIAL': { description: '材料属性', params: ['DENSITY', 'E', 'V', 'RAYLEIGHDAMPM', 'RAYLEIGHDAMPK', 'STATIC_FRICTION', 'CRITICAL_VELOCITY_VS', 'SLIDING_FRICTION', 'RESTITUTION'] },
  'SECTION': { description: '截面属性', params: ['TYPE', 'D', 'Y', 'Z', 'MATERIAL', 'VISD', 'ANGLE', 'THICKNESS', 'ALPHA', 'BETA', 'RDAMP', 'BENDCOFF'], typeOptions: { 'TYPE': ['BEAM_CIRCLE_SEC', 'BEAM_RECT_SEC', 'SHELL_LAYER'] } },
  'BEAMELE': { description: '梁/缆索单元', params: ['TYPE', 'SECTION', 'NODES', 'LENGTH0', 'PRECONFIG_VALID'], typeOptions: { 'TYPE': ['CABLE', 'BEAMEULER', 'VAR_LEN_CABLE'] } },
  'SHELLELE': { description: '壳单元', params: ['TYPE', 'LAYER', 'NODES'], typeOptions: { 'TYPE': ['SHELL_ANCF', 'SHELL_REISSNER',  'SHELL_ANCF_4', 'SHELL_ANCF_8'] } },
  'URDF': { description: 'URDF配置文件', params: ['URDFNAME', 'QG', 'FIX', 'COLLIDE'], typeOptions: {} },
  'CONSTRAINT': { description: '约束', params: ['TYPE', 'MARKER1', 'MARKER2', 'ACT_MARKER', 'SLAVE_MARKER', 'FNODE1', 'FNODE2', 'RIGIDBODY1', 'RIGIDBODY2', 'RIGIDBODY', 'CONSDOF', 'ABS_QG', 'K', 'DAMPING', 'F0', 'T0'], typeOptions: { 'TYPE': ['REVOLUTE', 'SPHERICAL', 'CYLINDRICAL', 'PRISMATIC', 'UNIVERSAL', 'LOCK', 'FREE', 'MOTOR_VEL_ROT', 'MOTOR_ROT', 'MOTOR_VEL_LIN', 'MOTOR_LIN', 'FNODEA_POINT_POINT', 'FNODEA_POINT_FRAME', 'FNODEA_DIR_FRAME', 'CONSGENERIC', 'SPRING_DAMPER', 'ROT_SPRING_DAMPER', 'LINEAR_ACTUATOR'] } },
  'MARKER': { description: '标记点', params: ['BODY_NAME', 'QG'] },
  'INPUT': { description: '输入设置', params: ['TYPE', 'CLASS', 'BODY_TYPE', 'NAME', 'PAR_NUM', 'INIT_VAL'], typeOptions: { 'TYPE': ['TORQUE_INPUT', 'FORCE_INPUT', 'FORCE_TORQUE_INPUT', 'RIGID_MOTION_INPUT', 'RIGID_MOTION_VEL_INPUT', 'RIGID_MOTION_ACC_INPUT', 'DRIVEN_INPUT', 'DRIVEN_MOTION_INPUT', 'VEL_INPUT', 'CHANGE_CONS_TYPE', 'SCALEMAX', 'SCALEMIN', 'MOTION_INPUT', 'LOCK_FREE', 'TIME_STEP'] } },
  'OUTPUT': { description: '输出设置', params: ['TYPE', 'CLASS', 'BODY_TYPE', 'NAME', 'PAR_NUM'], typeOptions: { 'TYPE': ['TIME', 'POSQUAT_OUTPUT', 'POSQUAT_VEL_OUTPUT', 'NODE_STAT_OUTPUT', 'NODE_STAT_VEL_OUTPUT', 'MARKER_STAT_OUTPUT', 'MARKER_STAT_VEL_OUTPUT', 'DRIVEN_OUTPUT', 'DRIVEN_VEL_OUTPUT', 'CONT_F_TOR_OUTPUT', 'BEAMSEC_F_TOR_OUTPUT', 'SPRING_FORCE_OUTPUT', 'SPRING_LENGTH_OUTPUT', 'SPRING_VEL_OUTPUT', 'CONS_FOR_OUTPUT', 'CONS_FOR_TOR_OUTPUT'] } },
  'COSIM': { description: '联合仿真', params: ['TYPE', 'PORTNUM', 'INPUT_NUM', 'OUTPUT_NUM'], typeOptions: { 'TYPE': ['MATLAB'] } },
  'ARCHIVE': { description: '归档设置', params: ['TYPE', 'OUTPUT_FILE', 'INPUT_FILE', 'SAVEMBS_FILE', 'ENSIGHT_FILE', 'ALLDATA_FILE', 'EXODUS_FILE', 'POVRAY_FILE'], typeOptions: { 'TYPE': ['FILE'] } },
  'CAMERA': { description: '相机设置', params: ['TYPE', 'CAM_MODE', 'MARKER_NAME', 'NEAR_VALUE', 'FAR_VALUE', 'FOVY', 'ASPECT'], typeOptions: { 'TYPE': ['FIX_CAM'] } },
  'GRAVITY': { description: '重力设置', params: ['VALID', 'VALUE'] },
  'ENVSETUP': { description: '环境设置', params: ['RESOLUTION', 'CAMERA_POS', 'DRAW', 'DRAWGRID', 'DRAWGRIDBG', 'DRAWBODYCS', 'DRAWMARKERCS', 'PIC_SAVE', 'VIS_SAVE_FRAMES', 'LIGHT1_POS_RAD_COL', 'LIGHT2_POS_RAD_COL', 'FLEX_COLLIDE', 'FLEX_COLLIDE_MODE', 'CONTACT_POINT_SIZE', 'FLEX_COLLIDE_MAT'] },
  'SOLVER': { description: '求解器设置', params: ['INT_TYPE', 'TIMESTEP', 'ALPHA', 'ITERMAX', 'TOL_ABS', 'TEND', 'SOL_TYPE'], typeOptions: { 'INT_TYPE': ['INT_HHT', 'INT_HHTV', 'INT_EULER_IMPLICIT_LINEARIZED', 'INT_NEWMARK'] } },



};

const PARAM_OPTIONS: { [key: string]: string[] } = {
  'FIX': ['0', '1'], 'COLLIDE': ['0', '1'], 'VALID': ['0', '1'], 'PRECONFIG_VALID': ['0', '1'],
  'DRAW': ['0', '1'], 'DRAWGRID': ['0', '1'], 'DRAWGRIDBG': ['0', '1'], 'DRAWBODYCS': ['0', '1'],
  'DRAWMARKERCS': ['0', '1'], 'PIC_SAVE': ['0', '1'], 'FLEX_COLLIDE': ['0', '1'],
  'FLEX_COLLIDE_MODE': ['0', '1'], 'CAM_MODE': ['0', '1']
};

const PARAM_DOCS: { [key: string]: string } = {
  'QG': '广义坐标位置 (x,y,z,qw,qx,qy,qz)', 'VG': '广义速度 (vx,vy,vz,wx,wy,wz)',
  'QR': '相对位置四元数 (x,y,z,qw,qx,qy,qz)', 'MASS': '质量 (kg)', 'INERTIAL': '惯性张量 (Ixx,Iyy,Izz,Ixy,Ixz,Iyz)',
  'DENSITY': '密度 (kg/m³)', 'E': '弹性模量 (Pa)', 'V': '泊松比',
  'D': '直径/截面尺寸 (m)', 'Y': '截面宽度/刚体宽度 (m)', 'Z': '截面长度/刚体高度 (m)',
  'X': '刚体长度 (m)', 'LENGTH0': '初始长度 (m)', 'TIMESTEP': '时间步长 (s)',
  'TEND': '仿真结束时间 (s)', 'ALPHA': 'HHT参数/剪切因子', 'BETA': '扭矩因子',
  'ITERMAX': '最大迭代次数', 'TOL_ABS': '绝对误差容限', 'PAR_NUM': '参数数量',
  'INIT_VAL': '初始值', 'PORTNUM': '端口号', 'RADIUS': '半径 (m)',
  'HEIGHT': '高度 (m)', 'ROU': '密度 (kg/m³)', 'OBJFILE': 'OBJ文件名',
  'SCALE': '缩放尺寸', 'SCALING': '缩放比例', 'SPHERE_SWEPT': '碰撞颗粒最小尺寸 (m)',
  'SAFE_MARGIN': '碰撞检测边界大小 (m)', 'COG': '质心位置', 'TEXTURE_FILE': '纹理图片文件',
  'TEXTURE_SCALE': '纹理缩放比例', 'BOT_CENTER': '下底面圆心坐标', 'TOP_CENTER': '上底面圆心坐标',
  'LENGTHS': '几何尺寸 (x,y,z)', 'COLOR': '颜色 (R,G,B,亮度)', 'VISD': '可视化显示直径',
  'RDAMP': '阻尼系数', 'BENDCOFF': '弯曲刚度缩放因子', 'THICKNESS': '厚度 (m)',
  'ANGLE': '纤维角度 (°)', 'BODY_NAME': '固连的刚体名称', 'MARKER1': '标记点1',
  'MARKER2': '标记点2', 'ACT_MARKER': '主动作用标记点', 'SLAVE_MARKER': '被动作用标记点',
  'FNODE1': '柔性节点1', 'FNODE2': '柔性节点2', 'RIGIDBODY1': '刚体1',
  'RIGIDBODY2': '刚体2', 'RIGIDBODY': '刚体', 'CONSDOF': '约束自由度 (x,y,z,rx,ry,rz)',
  'ABS_QG': '作用点坐标系/约束坐标位置', 'K': '弹簧刚度系数', 'DAMPING': '弹簧阻尼系数',
  'F0': '初始恢复力', 'T0': '初始恢复力矩', 'CLASS': '作用体类别 (RIGIDBODY/FNODE/CONSTRAINT/BEAM)',
  'BODY_TYPE': '作用体类别中的具体种类', 'NAME': '名称', 'NODES': '节点列表',
  'LAYER': '截面名称', 'SECTION': '截面名称', 'MATERIAL': '材料名称',
  'STATIC_FRICTION': '静摩擦系数', 'CRITICAL_VELOCITY_VS': '静摩擦临界速度',
  'SLIDING_FRICTION': '滑动摩擦系数', 'RESTITUTION': '碰撞恢复系数',
  'RAYLEIGHDAMPM': 'Rayleigh阻尼M', 'RAYLEIGHDAMPK': 'Rayleigh阻尼K',
  'RESOLUTION': '仿真界面分辨率 (宽,高)', 'CAMERA_POS': '相机位置 (x,y,z)',
  'VIS_SAVE_FRAMES': '三维可视化图片存储间隔帧数', 'LIGHT1_POS_RAD_COL': '相机1位置、光照半径、颜色',
  'LIGHT2_POS_RAD_COL': '相机2位置、光照半径、颜色', 'CONTACT_POINT_SIZE': '碰撞检测节点直径 (m)',
  'FLEX_COLLIDE_MAT': '柔性碰撞面材料', 'OUTPUT_FILE': '输出文件名称', 'INPUT_FILE': '输入文件名称',
  'SAVEMBS_FILE': 'mbs格式保存文件', 'ENSIGHT_FILE': 'ENSIGHT格式文件',
  'ALLDATA_FILE': '所有数据文件 (ASCII)', 'EXODUS_FILE': 'EXODUS格式文件',
  'POVRAY_FILE': 'POVRAY格式文件', 'MARKER_NAME': '绑定的标记点名称',
  'NEAR_VALUE': '景深近', 'FAR_VALUE': '景深远', 'FOVY': '视场角 (弧度)',
  'ASPECT': '视场比例', 'SOL_TYPE': '求解器类型 (如SOLVER_MKL)',

//20260313
  'FNODE_RQ': '位置 r/四元数，自由度 7', 'FNODEA_RD': '位置 r/导数，自由度 6',
  'BEAMEULER': '索梁单元', 'CABLE': '索梁单元', 'VAR_LEN_CABLE': '可变长度索梁单元',
  'SHELL_REISSNER': '板壳单元', 'SHELL_LAYER': '板壳截面', 'BEAM_CIRCLE_SEC': '索梁圆形截面',
  'SHELL_ANCF': '板壳单元适用于 FNODEA_RD 节点', 'SHELL_ANCF_4': '板壳单元适用 FNODEA_RDDD节点', 'SHELL_ANCF_8': '板壳单元适用于 FNODEA_RDD节点',
  'BEAM_RECT_SEC': '索梁方形截面', 'BOX': '立方体几何', 'CYLINDER': '圆柱几何','GENERAL': '一般刚体',
  'REVOLUTE': '旋转铰', 'SPHERICAL': '球铰', 'CYLINDRICAL': '圆柱铰','PRISMATIC': '滑移铰',
  'LOCK': '固定铰', 'FREE': '自由铰', 'MOTOR_ROT': '旋转角度 Z 方向驱动铰','MOTOR_VEL_ROT': '旋转速度 Z 方向驱动铰',
  'MOTOR_LIN ': '平移位置 X 方向驱动铰', 'MOTOR_VEL_LIN': '平移速度 X 方向驱动铰', 
  'FNODEA_POINT_FRAME': '柔性节点之间约束位置FNODE_RQ 不适用','FNODEA_DIR_FRAME': '柔性节点之间约束姿态FNODE_RQ 不适用',
  'CONSGENERIC ': '一般约束', 'SPRING_DAMPER': '弹簧阻尼约束', 'ROT_SPRING_DAMPER': '卷簧阻尼约束', 
  'LINEAR_ACTUATOR ': '线型驱动约束',

};

function resolveVariables(text: string, document: vscode.TextDocument): string {
  const file = document.uri.fsPath;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath || '';
  const fileDirname = path.dirname(file);
  const fileBasename = path.basename(file);
  const fileBasenameNoExt = path.basename(file, path.extname(file));
  const fileExtname = path.extname(file);
  return text
    .replace(/\${file}/g, file).replace(/\${workspaceFolder}/g, workspaceFolder)
    .replace(/\${fileDirname}/g, fileDirname).replace(/\${fileBasename}/g, fileBasename)
    .replace(/\${fileBasenameNoExt}/g, fileBasenameNoExt).replace(/\${fileExtname}/g, fileExtname);
}

function getNextId(document: vscode.TextDocument, keyword: string): number {
  const text = document.getText();
  const regex = new RegExp(keyword + '\\/(\\d+)', 'g');
  let maxId = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const id = parseInt(match[1], 10);
    if (id > maxId) maxId = id;
  }
  return maxId + 1;
}

function extractNames(text: string, regex: RegExp): string[] {
  const names: string[] = [];
  const seen: { [key: string]: boolean } = {};
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    if (!seen[name]) { seen[name] = true; names.push(name); }
  }
  return names;
}

class MBSimHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const loc = referenceLocations.find(r => r.line === position.line && position.character >= r.start && position.character <= r.end);
    if (loc) {
      const contents = new vscode.MarkdownString();
      if (loc.type === 'chineseChar') {
        contents.appendMarkdown(`⚠️ **中文字符警告**\n\n字符: \`${loc.value}\`\n\n位置: 第 ${loc.line + 1} 行, 第 ${loc.start + 1} 列\n\n**问题**: MBSim输入文件格式建议使用纯英文字符\n\n`);
        return new vscode.Hover(contents, new vscode.Range(loc.line, loc.start, loc.line, loc.end));
      }
      const rule = crossRefRules.find(r => r.keyword === loc.keyword && r.param === loc.param);
      if (rule) {
        let exists = false;
        if ((rule as any).isMultiSet && rule.set.includes(',')) {
          const sets = rule.set.split(',');
          exists = sets.some(setName => {
            const set = definitionSets[setName.trim()];
            return set && set.has(loc.value);
          });
        } else {
          exists = definitionSets[rule.set]?.has(loc.value) ?? false;
        }
        
        const displayName = rule.displayName || loc.param;
        if (exists) {
          contents.appendMarkdown(`✅ **已定义的${displayName}**: \`${loc.value}\`\n\n类型: ${rule.set}\n\n被 ${loc.keyword} 引用`);
        } else {
          contents.appendMarkdown(`❌ **未定义的${displayName}**: \`${loc.value}\`\n\n**错误**: ${loc.keyword} 引用了不存在的 ${displayName}\n\n`);
          let available: string[] = [];
          if ((rule as any).isMultiSet && rule.set.includes(',')) {
            const sets = rule.set.split(',');
            available = sets.flatMap(setName => {
              const set = definitionSets[setName.trim()];
              return set ? Array.from(set) : [];
            });
          } else {
            available = Array.from(definitionSets[rule.set] || []);
          }
          if (available.length > 0) {
            contents.appendMarkdown(`**可用的定义**:\n`);
            available.forEach(name => contents.appendMarkdown(`- \`${name}\`\n`));
          } else {
            contents.appendMarkdown(`*当前文件中没有定义任何 ${rule.set}*`);
          }
        }
        return new vscode.Hover(contents, new vscode.Range(loc.line, loc.start, loc.line, loc.end));
      }
    }
    const wordRange = document.getWordRangeAtPosition(position, /[A-Z_]+/);
    if (!wordRange) return undefined;
    const word = document.getText(wordRange);
    if (PARAM_DOCS[word]) return new vscode.Hover(PARAM_DOCS[word]);
    if (MBSIM_SCHEMA[word]) return new vscode.Hover(`**${word}**\n\n${MBSIM_SCHEMA[word].description}\n\n可用参数: ${MBSIM_SCHEMA[word].params.join(', ')}`);
    return undefined;
  }
}

// ==================== 折叠区域支持 (!<-! ... !->!) ====================

class MBSimFoldingRangeProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const startMarker = /^\s*!<-!/;
    const endMarker = /^\s*!->!/;

    const stack: number[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i).text;
      if (startMarker.test(line)) {
        stack.push(i);
      } else if (endMarker.test(line) && stack.length > 0) {
        const startLine = stack.pop()!;
        const foldStart = startLine + 3;   // 前三行内容保持可见
        const foldEnd = i - 1;             // 结束标记前一行
        if (foldStart <= foldEnd) {
          ranges.push(new vscode.FoldingRange(foldStart, foldEnd, vscode.FoldingRangeKind.Region));
        }
      }
    }
    return ranges;
  }
}

async function autoFoldMBSimRegions(editor: vscode.TextEditor): Promise<void> {
  const doc = editor.document;
  const startMarker = /^\s*!<-!/;
  const endMarker = /^\s*!->!/;

  let startLine = -1;
  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i).text;
    if (startMarker.test(line)) {
      startLine = i;
    } else if (endMarker.test(line) && startLine >= 0) {
      const foldStart = startLine + 3;
      if (foldStart < i) {
        const position = new vscode.Position(foldStart, 0);
        editor.selection = new vscode.Selection(position, position);
        await vscode.commands.executeCommand('editor.fold');
      }
      startLine = -1;
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const checkExtensionUpdateCommand = vscode.commands.registerCommand('mbsim.checkExtensionUpdate', async () => {
    await checkExtensionUpdate(context, true);
  });

  setTimeout(() => {
    checkForUpdates(context, false);
    setTimeout(() => checkExtensionUpdate(context, false), 10000);
  }, 5000);
  // 延迟检查是否需要显示更新日志（确保 VS Code 完全加载）
  setTimeout(() => {
    showChangelogIfFlagged(context);
  }, 2000);
  const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'mbsim', scheme: 'file' },
    {
      provideCompletionItems(document, position) {
        const line = document.lineAt(position).text;
        const linePrefix = line.substring(0, position.character);
        const keywordMatch = linePrefix.match(/^(\s*)([A-Z]*)$/);
        if (keywordMatch) {
          const leadingSpace = keywordMatch[1];
          const typed = keywordMatch[2];
          const matches = Object.keys(MBSIM_SCHEMA).filter(key => key.indexOf(typed) === 0);
          if (matches.length > 0) {
            return matches.map(key => {
              const item = new vscode.CompletionItem(key + '/', vscode.CompletionItemKind.Class);
              item.detail = MBSIM_SCHEMA[key].description;
              const nextId = getNextId(document, key);
              const noNameKeys = ['INPUT', 'OUTPUT', 'COSIM', 'ARCHIVE', 'GRAVITY', 'ENVSETUP', 'SOLVER', 'CAMERA'];
              const fullText = noNameKeys.indexOf(key) >= 0
                ? key + '/' + nextId.toString() + ', '
                : key + '/' + nextId.toString() + ', ${1}, ';
              if (typed.length > 0) {
                item.insertText = new vscode.SnippetString(fullText);
                item.range = new vscode.Range(new vscode.Position(position.line, leadingSpace.length), new vscode.Position(position.line, position.character));
              } else {
                item.insertText = new vscode.SnippetString(fullText);
              }
              return item;
            });
          }
        }
        const lineKeywordMatch = linePrefix.match(/^(\s*)([A-Z]+)\/\d+/);
        if (lineKeywordMatch) {
          const keyword = lineKeywordMatch[2];
          const schema = MBSIM_SCHEMA[keyword];
          if (!schema) return undefined;
          const existingParams: string[] = [];
          const paramMatches = linePrefix.match(/([A-Z_]+)\s*=/g);
          if (paramMatches) paramMatches.forEach(m => existingParams.push(m.replace(/\s*=/, '').trim()));
          return schema.params.filter(param => existingParams.indexOf(param) < 0).map(param => {
            const item = new vscode.CompletionItem(param, vscode.CompletionItemKind.Property);
            item.detail = PARAM_DOCS[param] || '';
            let options: string[] | undefined;
            if (schema.typeOptions?.[param]) options = schema.typeOptions[param];
            else if (PARAM_OPTIONS[param]) options = PARAM_OPTIONS[param];
            if (options) item.insertText = new vscode.SnippetString(param + '=${1|' + options.join(',') + '|}');
            else if (param === 'QG' || param === 'QR' || param === 'ABS_QG') item.insertText = new vscode.SnippetString(param + '=${1:},${2:},${3:},${4:},${5:},${6:},${7:}');
            else if (param === 'VG') item.insertText = new vscode.SnippetString(param + '=${1:0.0},${2:0.0},${3:0.0},${4:0.0},${5:0.0},${6:0.0},${7:0.0}');
            else if (param === 'INERTIAL') item.insertText = new vscode.SnippetString(param + '=${1:},${2:},${3:},${4:},${5:},${6:}');
            else if (param === 'VALUE' && keyword === 'GRAVITY') item.insertText = new vscode.SnippetString(param + '=${1:0},${2:-9.8},${3:0}');
            else if (param === 'RESOLUTION') item.insertText = new vscode.SnippetString(param + '=${1:1200}, ${2:1000}');
            else if (param === 'CAMERA_POS') item.insertText = new vscode.SnippetString(param + '=${1:0}, ${2:2}, ${3:2.0}');
            else if (param === 'CONSDOF') item.insertText = new vscode.SnippetString(param + '=${1:1},${2:1},${3:1},${4:0},${5:0},${6:0}');
            else if (param === 'NODES') {
              const text = document.getText();
              const nodes = extractNames(text, /FNODE\/\d+,\s*(\w+)/g);
              item.insertText = nodes.length > 0 ? param + '=' + nodes.join(',') : param + '=node1,node2';
            }
            else if (param === 'MATERIAL') {
              const text = document.getText();
              const materials = extractNames(text, /MATERIAL\/\d+,\s*(\w+)/g);
              item.insertText = materials.length > 0 ? new vscode.SnippetString(param + '=${1|' + materials.join(',') + '|}') : param + '=';
            }
            else if (param === 'GEOMETRY') {
              const text = document.getText();
              const geoms = extractNames(text, /GEOMETRY\/\d+,\s*(\w+)/g);
              item.insertText = geoms.length > 0 ? new vscode.SnippetString(param + '=${1|' + geoms.join(',') + '|}') : param + '=';
            }
            else if (param === 'RIGIDBODY1' || param === 'RIGIDBODY2' || param === 'RIGIDBODY') {
              const text = document.getText();
              const bodies = extractNames(text, /RIGIDBODY\/\d+,\s*(\w+)/g);
              item.insertText = bodies.length > 0 ? new vscode.SnippetString(param + '=${1|' + bodies.join(',') + '|}') : param + '=';
            }
            else if (param === 'FNODE1' || param === 'FNODE2') {
              const text = document.getText();
              const fnodes = extractNames(text, /FNODE\/\d+,\s*(\w+)/g);
              item.insertText = fnodes.length > 0 ? new vscode.SnippetString(param + '=${1|' + fnodes.join(',') + '|}') : param + '=';
            }
            else if (param === 'LAYER' || param === 'SECTION') {
              const text = document.getText();
              const sections = extractNames(text, /SECTION\/\d+,\s*(\w+)/g);
              item.insertText = sections.length > 0 ? new vscode.SnippetString(param + '=${1|' + sections.join(',') + '|}') : param + '=';
            }
            else if (param === 'MARKER1' || param === 'MARKER2' || param === 'ACT_MARKER' || param === 'SLAVE_MARKER' || param === 'MARKER_NAME') {
              const text = document.getText();
              const markers = extractNames(text, /MARKER\/\d+,\s*(\w+)/g);
              item.insertText = markers.length > 0 ? new vscode.SnippetString(param + '=${1|' + markers.join(',') + '|}') : param + '=';
            }
            else if (param === 'BODY_NAME') {
              const text = document.getText();
              const bodies = extractNames(text, /RIGIDBODY\/\d+,\s*(\w+)/g);
              item.insertText = bodies.length > 0 ? new vscode.SnippetString(param + '=${1|' + bodies.join(',') + '|}') : param + '=';
            }
            else if (param === 'NAME') {
              const classMatch = linePrefix.match(/CLASS\s*=\s*(\w+)/);
              if (classMatch) {
                const classType = classMatch[1];
                const text = document.getText();
                let names: string[] = [];
                if (classType === 'RIGIDBODY') names = extractNames(text, /RIGIDBODY\/\d+,\s*(\w+)/g);
                else if (classType === 'CONSTRAINT') names = extractNames(text, /CONSTRAINT\/\d+,\s*(\w+)/g);
                else if (classType === 'FNODE') names = extractNames(text, /FNODE\/\d+,\s*(\w+)/g);
                else if (classType === 'BEAM') names = extractNames(text, /BEAMELE\/\d+,\s*(\w+)/g);
                item.insertText = names.length > 0 ? new vscode.SnippetString(param + '=${1|' + names.join(',') + '|}') : param + '=';
              } else item.insertText = param + '=';
            }
            else if (param === 'INIT_VAL' || param === 'PAR_NUM') {
              const typeMatch = linePrefix.match(/TYPE\s*=\s*(\w+)/);
              if (typeMatch) {
                const typeValue = typeMatch[1];
                if (typeValue === 'FORCE_TORQUE_INPUT') item.insertText = new vscode.SnippetString(param + '=${1:0},${2:0},${3:0},${4:0},${5:0},${6:0},${7:0},${8:0},${9:0},${10:1}');
                else if (typeValue === 'TORQUE_INPUT') item.insertText = new vscode.SnippetString(param + '=${1:0},${2:0},${3:0},${4:0}');
                else if (typeValue === 'FORCE_INPUT') item.insertText = new vscode.SnippetString(param + '=${1:0},${2:0},${3:0},${4:0},${5:0},${6:0},${7:0}');
                else if (typeValue === 'RIGID_MOTION_INPUT' || typeValue === 'RIGID_MOTION_VEL_INPUT') item.insertText = new vscode.SnippetString(param + '=${1:0},${2:0},${3:0},${4:1},${5:0},${6:0},${7:0}');
                else if (typeValue === 'RIGID_MOTION_ACC_INPUT') item.insertText = new vscode.SnippetString(param + '=${1:0},${2:0},${3:0}');
                else if (['DRIVEN_INPUT', 'DRIVEN_MOTION_INPUT', 'VEL_INPUT', 'CHANGE_CONS_TYPE', 'SCALEMAX', 'SCALEMIN', 'LOCK_FREE', 'TIME_STEP'].includes(typeValue)) item.insertText = new vscode.SnippetString(param + '=${1:0}');
                else item.insertText = param + '=';
              } else item.insertText = param + '=';
            }
            else if (param === 'LIGHT1_POS_RAD_COL' || param === 'LIGHT2_POS_RAD_COL') item.insertText = new vscode.SnippetString(param + '=${1:0},${2:0},${3:0},${4:100}');
            else item.insertText = param + '=';
            return item;
          });
        }
        return undefined;
      }
    }
  );

  const hoverProvider = vscode.languages.registerHoverProvider('mbsim', new MBSimHoverProvider());
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('mbsim');

  // 修改：validateDocument 改为异步以支持 URDF 解析
const validateDocument = async (document: vscode.TextDocument) => {
  if (document.languageId !== 'mbsim') return;
  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();
  const lines = text.split('\n');
  
  await collectDefinitionsAsync(lines);

  lines.forEach((line, lineIndex) => {
    const commentIndex = line.indexOf('!');
    const codePart = commentIndex >= 0 ? line.substring(0, commentIndex) : line;
    validateChineseChars(codePart, lineIndex, 0, 'line', diagnostics);
    
    const commentMatch = line.match(/^(\s*)!(.*)/);
    if (commentMatch && commentMatch[1].length > 0) {
      diagnostics.push(createDiagnostic(lineIndex, 0, line.length, '注释符 "!" 应该位于行首，不应有前导空格', vscode.DiagnosticSeverity.Warning));
    }
    
    const defMatch = codePart.match(/^(\s*)([a-zA-Z][a-zA-Z0-9_]*)\/(\d+)\s*,/);
    if (defMatch) {
      const rawKeyword = defMatch[2];
      const keyword = rawKeyword.toUpperCase();
      const idStr = defMatch[3];
      const id = parseInt(idStr, 10);
      const lineStart = defMatch[1].length;
      
      if (!MBSIM_SCHEMA[keyword]) {
        diagnostics.push(createDiagnostic(lineIndex, lineStart, lineStart + rawKeyword.length, `未知的关键字类型: ${rawKeyword}，应为全大写形式`, vscode.DiagnosticSeverity.Error));
      }
      if (id < 0) diagnostics.push(createDiagnostic(lineIndex, lineStart + rawKeyword.length + 1, lineStart + rawKeyword.length + 1 + idStr.length, 'ID 必须为非负整数', vscode.DiagnosticSeverity.Error));
      
      const paramsPart = codePart.substring(defMatch[0].length);
      
      // ✅ 修复：使用更智能的参数解析，支持多值参数
      const knownParams = MBSIM_SCHEMA[keyword]?.params || [];
      const paramRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*/g;
      let paramMatch: RegExpExecArray | null;
      
      while ((paramMatch = paramRegex.exec(paramsPart)) !== null) {
        const rawParamName = paramMatch[1];
        const paramName = rawParamName.toUpperCase();
        const valueStartIndex = paramMatch.index + paramMatch[0].length;
        
        // 判断这个参数是否是多值参数（NODES）
        const isMultiValueParam = crossRefRules.some(r => 
          r.keyword === keyword && r.param === paramName && (r as any).isMultiValue
        );
        
        let paramValue: string;
        let valueEndIndex: number;
        
        if (isMultiValueParam) {
          // ✅ 多值参数：捕获到下一个已知参数名之前，或到行尾
          const remainingText = paramsPart.substring(valueStartIndex);
          // 转义参数名中的正则特殊字符
          const nextParamPattern = knownParams.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
          const nextParamRegex = new RegExp(`\\s*,\\s*(?:${nextParamPattern})\\s*=`, 'i');
          const nextParamMatch = remainingText.match(nextParamRegex);
          
          if (nextParamMatch && nextParamMatch.index !== undefined) {
            paramValue = remainingText.substring(0, nextParamMatch.index).trim();
            valueEndIndex = valueStartIndex + nextParamMatch.index;
          } else {
            paramValue = remainingText.trim();
            valueEndIndex = paramsPart.length;
          }
        } else {
          // 普通参数：捕获到逗号或行尾
          const valueMatch = paramsPart.substring(valueStartIndex).match(/^([^,]*)/);
          paramValue = valueMatch ? valueMatch[1].trim() : '';
          valueEndIndex = valueStartIndex + paramValue.length;
        }
        
        const absoluteStart = defMatch[0].length + valueStartIndex;
        const absoluteEnd = defMatch[0].length + valueEndIndex;
        
        validateChineseChars(rawParamName, lineIndex, defMatch[0].length + paramMatch.index, `${keyword} param`, diagnostics);
        validateChineseChars(paramValue, lineIndex, absoluteStart, `${keyword}.${paramName}`, diagnostics);
        
        if (MBSIM_SCHEMA[keyword] && !MBSIM_SCHEMA[keyword].params.includes(paramName)) {
          const suggestions = findSimilarParams(keyword, paramName);
          let message = `参数 "${rawParamName}" 不是 ${keyword} 的标准参数`;
          if (suggestions.length > 0) message += `，您是否想输入: ${suggestions.join(', ')}`;
          diagnostics.push(createDiagnostic(lineIndex, defMatch[0].length + paramMatch.index, defMatch[0].length + paramMatch.index + rawParamName.length, message, vscode.DiagnosticSeverity.Warning));
        }
        
        if (paramName === 'TYPE' && MBSIM_SCHEMA[keyword]?.typeOptions?.TYPE) {
          const validTypes = MBSIM_SCHEMA[keyword].typeOptions!.TYPE!;
          if (!validTypes.includes(paramValue.toUpperCase())) diagnostics.push(createDiagnostic(lineIndex, absoluteStart, absoluteEnd, `无效的 TYPE 值 "${paramValue}"，应为: ${validTypes.join(', ')}`, vscode.DiagnosticSeverity.Error));
        }
        
        if (['MASS', 'DENSITY', 'E', 'V', 'TIMESTEP', 'RADIUS', 'D', 'HEIGHT', 'Y', 'Z', 'X', 'LENGTH0', 'THICKNESS'].includes(paramName)) {
          const numValue = parseFloat(paramValue);
          if (isNaN(numValue) || numValue < 0) diagnostics.push(createDiagnostic(lineIndex, absoluteStart, absoluteEnd, `${rawParamName} 必须为非负数值`, vscode.DiagnosticSeverity.Error));
        }
        
        // ✅ 使用更新后的位置信息调用交叉引用验证
        validateCrossRef(keyword, paramName, paramValue, lineIndex, absoluteStart, absoluteEnd, diagnostics);
      }
    }
    
    if ((codePart.match(/"/g) || []).length % 2 !== 0) diagnostics.push(createDiagnostic(lineIndex, 0, codePart.length, '字符串引号未闭合', vscode.DiagnosticSeverity.Error));
  });
  
  diagnosticCollection.set(document.uri, diagnostics);
};
  

  function createDiagnostic(line: number, startChar: number, endChar: number, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
    const range = new vscode.Range(line, startChar, line, endChar);
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = 'MBSIM';
    return diagnostic;
  }

  function findSimilarParams(keyword: string, input: string): string[] {
    if (!MBSIM_SCHEMA[keyword]) return [];
    return MBSIM_SCHEMA[keyword].params.filter(p => p.substring(0, 3) === input.substring(0, 3) && p !== input).slice(0, 3);
  }

  // 监听文档变化（异步处理）
  vscode.workspace.onDidChangeTextDocument(async e => {
    if (e.document.languageId === 'mbsim') {
      await validateDocument(e.document);
    }
  });

  // 折叠区域 Provider
  const foldingProvider = vscode.languages.registerFoldingRangeProvider('mbsim', new MBSimFoldingRangeProvider());

  // 文档打开时自动折叠 !<-! ... !->! 区域
  const autoFoldListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (editor && editor.document.languageId === 'mbsim') {
      await new Promise(resolve => setTimeout(resolve, 200));
      await autoFoldMBSimRegions(editor);
    }
  });

  // 也处理已打开的文档
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.languageId === 'mbsim') {
    setTimeout(() => autoFoldMBSimRegions(activeEditor), 500);
  }

  const configureSimulatorCommand = vscode.commands.registerCommand('mbsim.configureSimulator', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:你的扩展ID mbsim.simulator.path');
  });
  const configureParaviewCommand = vscode.commands.registerCommand('mbsim.configureParaview', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:你的扩展ID mbsim.paraview.path');
  });
  const configureCommand = vscode.commands.registerCommand('mbsim.configure', async () => {
    const items = [
      { label: '仿真路径', description: '设置动力学仿真软件路径', target: 'mbsim.simulator.path' },
      { label: 'ParaView路径', description: '设置ParaView可执行文件路径', target: 'mbsim.paraview.path' },
    ];
    const selected = await vscode.window.showQuickPick(items, { placeHolder: '选择要配置的项' });
    if (selected) vscode.commands.executeCommand('workbench.action.openSettings', selected.target);
  });

  const runSimulationCommand = vscode.commands.registerCommand('mbsim.runSimulation', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('没有打开的文件'); return; }
    const document = editor.document;
    if (document.languageId !== 'mbsim') { vscode.window.showErrorMessage('当前文件不是MBSIM语言'); return; }
    const fileDir = path.dirname(document.uri.fsPath);
    const configFilePath = path.join(fileDir, 'DefaultConfig.mbs');
    const batFilePath = path.join(fileDir, 'run_mbsim.bat');
    try { fs.writeFileSync(configFilePath, document.getText(), 'utf8'); } catch (err) { vscode.window.showErrorMessage(`无法写入配置文件: ${err}`); return; }
    const config = vscode.workspace.getConfiguration('mbsim');
    const simulatorPath = config.get<string>('simulator.path', 'simulator.exe');
    const batContent = `@echo off\nstart "" "${simulatorPath}"\n`;
    try { fs.writeFileSync(batFilePath, batContent, 'utf8'); } catch (err) { vscode.window.showErrorMessage(`无法写入批处理文件: ${err}`); return; }
    const batProcess = spawn('cmd.exe', ['/c', batFilePath], { cwd: fileDir, detached: true, stdio: 'ignore' });
    batProcess.unref();
    vscode.window.showInformationMessage('仿真已启动，请查看新窗口');
  });

  const openParaviewCommand = vscode.commands.registerCommand('mbsim.openParaview', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showErrorMessage('没有打开的文件'); return; }
    const fileDir = path.dirname(editor.document.uri.fsPath);
    const caseFile = path.join(fileDir, 'Ensight', 'DefaultConfig_ensight.en.case');
    if (!fs.existsSync(caseFile)) { vscode.window.showErrorMessage(`找不到 case 文件：${caseFile}`); return; }
    const config = vscode.workspace.getConfiguration('mbsim');
    const paraviewPath = config.get<string>('paraview.path', 'paraview');
    const paraviewProcess = spawn(paraviewPath, [caseFile], { cwd: fileDir, detached: true, stdio: 'ignore' });
    paraviewProcess.unref();
    vscode.window.showInformationMessage('ParaView 已启动');
  });

  const checkUpdateCommand = vscode.commands.registerCommand('mbsim.checkUpdate', async () => {
    await checkForUpdates(context, true);
  });

  const downloadSimulatorCommand = vscode.commands.registerCommand('mbsim.downloadSimulator', async () => {
    const releaseInfo = await getLatestReleaseInfo();
    if (!releaseInfo) { vscode.window.showErrorMessage('无法获取最新版本信息'); return; }
    const { filename, downloadUrl } = releaseInfo;
    const defaultUri = vscode.Uri.file(path.join(os.homedir(), 'Downloads', filename));
    const uri = await vscode.window.showSaveDialog({ title: `保存 ${filename}`, defaultUri, filters: { 'Executable Files': ['exe'] } });
    if (!uri) return;
    await downloadFile(downloadUrl, uri.fsPath, filename, context);
  });

  async function getLatestReleaseInfo(): Promise<{ filename: string; downloadUrl: string } | null> {
    return new Promise((resolve) => {
      const options = { hostname: 'api.github.com', path: '/repos/xxjxxj288/MBdyn/releases/latest', method: 'GET', headers: { 'User-Agent': 'VSCode-MBSIM-Extension', 'Accept': 'application/vnd.github.v3+json' } };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const release = JSON.parse(data);
              const assets = release.assets || [];
              const exeAsset = assets.find((asset: any) => asset.name && asset.name.endsWith('.exe'));
              if (exeAsset) { resolve({ filename: exeAsset.name, downloadUrl: exeAsset.browser_download_url }); return; }
            }
            resolve(null);
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(15000, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  async function downloadFile(url: string, destPath: string, filename: string, context: vscode.ExtensionContext) {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在下载 ${filename}...`, cancellable: false }, async (progress) => {
      return new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const download = (currentUrl: string) => {
          https.get(currentUrl, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) { download(response.headers.location!); return; }
            if (response.statusCode !== 200) { reject(new Error(`下载失败: ${response.statusCode}`)); return; }
            const total = parseInt(response.headers['content-length'] || '0', 10);
            let received = 0;
            response.on('data', (chunk) => { received += chunk.length; if (total) progress.report({ message: `${((received/total)*100).toFixed(0)}%` }); });
            response.pipe(file);
            file.on('finish', async () => {
              file.close();
              const config = vscode.workspace.getConfiguration('mbsim');
              await config.update('simulator.path', destPath, vscode.ConfigurationTarget.Global);
              await context.globalState.update(LOCAL_FILENAME_KEY, filename);
              vscode.window.showInformationMessage(`${filename} 下载完成`);
              resolve();
            });
          }).on('error', reject);
        };
        download(url);
      });
    });
  }

  setTimeout(() => checkForUpdates(context, false), 5000);

  const statusBarItemRun = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItemRun.text = "$(play) 运行仿真";
  statusBarItemRun.command = "mbsim.runSimulation";
  statusBarItemRun.tooltip = "运行动力学仿真（生成 DefaultConfig.mbs 并执行批处理）";
  statusBarItemRun.show();

  const statusBarItemPV = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
  statusBarItemPV.text = "$(eye) ParaView";
  statusBarItemPV.command = "mbsim.openParaview";
  statusBarItemPV.tooltip = "用 ParaView 打开 Ensight/DefaultConfig_ensight.en.case";
  statusBarItemPV.show();

  const statusBarItemConfig = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
  statusBarItemConfig.text = "$(gear) 配置";
  statusBarItemConfig.command = "mbsim.configure";
  statusBarItemConfig.tooltip = "快速配置仿真路径或 ParaView 路径";
  statusBarItemConfig.show();

  const statusBarItemCheckUpdate = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 13);
  statusBarItemCheckUpdate.text = "$(sync) 检查MBdyn更新";
  statusBarItemCheckUpdate.command = "mbsim.checkUpdate";
  statusBarItemCheckUpdate.tooltip = "手动检查是否有新版本的仿真程序";
  statusBarItemCheckUpdate.show();

  const statusBarItemExtensionUpdate = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 14);
  statusBarItemExtensionUpdate.text = "$(extensions) 检查扩展更新";
  statusBarItemExtensionUpdate.command = "mbsim.checkExtensionUpdate";
  statusBarItemExtensionUpdate.tooltip = "检查 MBDyn Language Support 扩展是否有更新";
  statusBarItemExtensionUpdate.show();

  context.subscriptions.push(
    provider, hoverProvider, diagnosticCollection, configureCommand,
    runSimulationCommand, openParaviewCommand, checkUpdateCommand,
    statusBarItemRun, statusBarItemPV, statusBarItemConfig,
    downloadSimulatorCommand, statusBarItemCheckUpdate,
    checkExtensionUpdateCommand, statusBarItemExtensionUpdate,
    foldingProvider, autoFoldListener
  );
}

export function deactivate() {}