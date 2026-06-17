"use strict";
exports.__esModule = true;
exports.deactivate = exports.activate = void 0;
var vscode = require("vscode");
// MBSIM 语法定义
var MBSIM_BLOCKS = [
    'MBSIM_CABLE', 'RIGIDBODY', 'GEOMETRY', 'FNODE',
    'MATERIAL', 'SECTION', 'ELEMENT', 'CONSTRAINT',
    'INPUT', 'OUTPUT', 'COSIMULATION'
];
var MBSIM_KEYWORDS = {
    RIGIDBODY: ['TYPE', 'QG', 'MASS', 'INERTIAL', 'GEOMETRY', 'FIX', 'COLLIDE', 'GENERAL'],
    GEOMETRY: ['TYPE', 'QR', 'RADIUS', 'COLOR', 'SPHERE', 'BOX', 'CYLINDER'],
    FNODE: ['TYPE', 'QG', 'FNODEA_RD', 'FNODEA_RQ'],
    MATERIAL: ['DENSITY', 'E', 'v', 'RayleighDampM', 'RayleighDampK',
        'STATIC_FRICTION', 'SLIDING_FRICTION', 'RESTITUTION'],
    SECTION: ['TYPE', 'BEAM_CIRCLE_SEC', 'D', 'MATERIAL', 'VISD'],
    ELEMENT: ['TYPE', 'CABLE', 'SECTION', 'NODES', 'LENGTH0', 'PRECONFIG_VALID', 'BEAMELE'],
    CONSTRAINT: ['TYPE', 'FNODEA_POINT_FRAME', 'FNODEA_DIR_FRAME', 'FNODE1', 'RIGIDBODY2'],
    OUTPUT: ['TYPE', 'TIME', 'NODE_STAT_OUTPUT', 'NODE_STAT_VEL_OUTPUT',
        'CLASS', 'BODY_TYPE', 'NAME', 'PAR_NUM'],
    COSIMULATION: ['INT_TYPE', 'TIMESTEP', 'ALPHA', 'ITERMAX', 'TOL_ABS',
        'INT_EULER_IMPLICIT_LINEARIZED', 'INT_HHT', 'GRAVITY',
        'ENVSETUP', 'ARCHIVE', 'RESOLUTION', 'CAMERA_POS']
};
var MBSIM_SNIPPETS = [
    {
        prefix: 'rigidbody',
        label: 'RIGIDBODY/1',
        body: [
            'RIGIDBODY/${1:1}, ${2:NAME}, TYPE=GENERAL, QG=${3:0},${4:0},${5:0},${6:1},${7:0},${8:0},${9:0},  MASS=${10:1},  INERTIAL=${11:0.001},${12:0.001},${13:0.001},${14:0},${15:0},${16:0},  GEOMETRY=${17:geom1},  FIX=${18|0,1|}, COLLIDE=${19|0,1|}'
        ]
    },
    {
        prefix: 'geometry',
        label: 'GEOMETRY/1',
        body: [
            'GEOMETRY/${1:1},  ${2:name},  TYPE=${3|SPHERE,BOX,CYLINDER|},  QR=${4:0},${5:0},${6:0},${7:1},${8:0},${9:0},${10:0},  RADIUS=${11:0.001},  COLOR=${12:1},${13:0},${14:1},${15:0}'
        ]
    },
    {
        prefix: 'fnode',
        label: 'FNODE/1',
        body: [
            'FNODE/${1:1}, ${2:cq_1}, TYPE=FNODEA_RD, QG=${3:0.0},${4:0.0},${5:0.0},${6:1.0},${7:0.0},${8:0.0}'
        ]
    },
    {
        prefix: 'material',
        label: 'MATERIAL/1',
        body: [
            'MATERIAL/${1:1}, ${2:steel}, DENSITY=${3:7800}, E=${4:200000000000}, v=${5:0.3}, RayleighDampM=${6:0}, RayleighDampK=${7:0}'
        ]
    },
    {
        prefix: 'section',
        label: 'SECTION/1',
        body: [
            'SECTION/${1:1}, ${2:sec1}, TYPE=BEAM_CIRCLE_SEC, D=${3:0.004}, MATERIAL=${4:steel}, VISD=${5:0.01}'
        ]
    },
    {
        prefix: 'beamele',
        label: 'BEAMELE/1',
        body: [
            'BEAMELE/${1:1}, ${2:beam1}, TYPE=CABLE, SECTION=${3:sec1}, NODES=${4:cq_1}, ${5:cq_2}, LENGTH0=${6:0.05}, PRECONFIG_VALID=${7|0,1|}'
        ]
    },
    {
        prefix: 'constraint',
        label: 'CONSTRAINT/1',
        body: [
            'CONSTRAINT/${1:1}, ${2:cons1}, TYPE=${3|FNODEA_POINT_FRAME,FNODEA_DIR_FRAME|}, FNODE1=${4:cq_1}, RIGIDBODY2=${5:BOX1}'
        ]
    },
    {
        prefix: 'solver',
        label: 'SOLVER/1',
        body: [
            'SOLVER/${1:1}, INT_TYPE=${2|INT_HHT,INT_EULER_IMPLICIT_LINEARIZED|}, TIMESTEP=${3:0.001}, ALPHA=${4:-0.1}, ITERMAX=${5:100}, TOL_ABS=${6:1e-6}'
        ]
    }
];
function activate(context) {
    // 1. 区块补全 Provider
    var blockProvider = vscode.languages.registerCompletionItemProvider('mbsim', {
        provideCompletionItems: function (document, position) {
            var line = document.lineAt(position).text;
            var linePrefix = line.substring(0, position.character);
            // 检测是否在区块头部位置
            if (linePrefix.match(/^(\s*)\[?$/)) {
                var items = MBSIM_BLOCKS.map(function (block) {
                    var item = new vscode.CompletionItem("[".concat(block, "]"), vscode.CompletionItemKind.Struct);
                    item.detail = "MBSIM ".concat(block, " Block");
                    item.documentation = new vscode.MarkdownString("\u63D2\u5165 **".concat(block, "** \u533A\u5757\u5B9A\u4E49"));
                    item.insertText = new vscode.SnippetString("[".concat(block, "]\n\n[/").concat(block, "]"));
                    return item;
                });
                return items;
            }
            return undefined;
        }
    }, '[' // 触发字符
    );
    // 2. 关键字补全 Provider
    var keywordProvider = vscode.languages.registerCompletionItemProvider('mbsim', {
        provideCompletionItems: function (document, position) {
            var linePrefix = document.lineAt(position).text.substring(0, position.character);
            // 检测当前所在区块
            var currentBlock = getCurrentBlock(document, position);
            if (!currentBlock)
                return undefined;
            var keywords = MBSIM_KEYWORDS[currentBlock];
            if (!keywords)
                return undefined;
            // 过滤已输入的关键字
            var existingKeys = linePrefix.match(/\b[A-Z_]+\b/g) || [];
            return keywords
                .filter(function (kw) { return !existingKeys.includes(kw); })
                .map(function (kw) {
                var item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Property);
                item.detail = "".concat(currentBlock, " \u5C5E\u6027");
                // 根据关键字提供智能提示
                switch (kw) {
                    case 'TYPE':
                        item.insertText = new vscode.SnippetString('TYPE=${1|GENERAL,SPHERE,BOX,CYLINDER,CABLE,FNODEA_RD,FNODEA_POINT_FRAME,FNODEA_DIR_FRAME,BEAM_CIRCLE_SEC,INT_HHT,INT_EULER_IMPLICIT_LINEARIZED|}');
                        break;
                    case 'QG':
                        item.insertText = new vscode.SnippetString('QG=${1:0.0},${2:0.0},${3:0.0},${4:1.0},${5:0.0},${6:0.0},${7:0.0}');
                        item.documentation = '位置四元数 (x,y,z,qw,qx,qy,qz)';
                        break;
                    case 'NODES':
                        item.insertText = new vscode.SnippetString('NODES=${1:node1}, ${2:node2}');
                        break;
                    case 'FIX':
                    case 'COLLIDE':
                    case 'PRECONFIG_VALID':
                        item.insertText = new vscode.SnippetString("".concat(kw, "=${1|0,1|}"));
                        break;
                    default:
                        item.insertText = "".concat(kw, "=");
                }
                return item;
            });
        }
    }, '=', ',' // 触发字符
    );
    // 3. 代码片段 Provider
    var snippetProvider = vscode.languages.registerCompletionItemProvider('mbsim', {
        provideCompletionItems: function () {
            return MBSIM_SNIPPETS.map(function (snippet) {
                var item = new vscode.CompletionItem(snippet.prefix, vscode.CompletionItemKind.Snippet);
                item.detail = snippet.label;
                item.insertText = new vscode.SnippetString(snippet.body.join('\n'));
                item.documentation = new vscode.MarkdownString('```mbsim\n' + snippet.body.join('\n') + '\n```');
                return item;
            });
        }
    });
    // 4. 上下文感知补全（节点名、材料名等）
    var contextProvider = vscode.languages.registerCompletionItemProvider('mbsim', {
        provideCompletionItems: function (document, position) {
            var linePrefix = document.lineAt(position).text.substring(0, position.character);
            var text = document.getText();
            // 提取已定义的节点名
            if (linePrefix.includes('NODES=') || linePrefix.includes('FNODE1=')) {
                var nodeMatches = text.matchAll(/FNODE\/\d+,\s*(\w+)/g);
                var nodes = new Set();
                for (var _i = 0, nodeMatches_1 = nodeMatches; _i < nodeMatches_1.length; _i++) {
                    var match = nodeMatches_1[_i];
                    nodes.add(match[1]);
                }
                return Array.from(nodes).map(function (node) {
                    var item = new vscode.CompletionItem(node, vscode.CompletionItemKind.Variable);
                    item.detail = '已定义节点';
                    return item;
                });
            }
            // 提取已定义的材料名
            if (linePrefix.includes('MATERIAL=') && !linePrefix.includes('DENSITY')) {
                var matMatches = text.matchAll(/MATERIAL\/\d+,\s*(\w+)/g);
                var materials = new Set();
                for (var _a = 0, matMatches_1 = matMatches; _a < matMatches_1.length; _a++) {
                    var match = matMatches_1[_a];
                    materials.add(match[1]);
                }
                return Array.from(materials).map(function (mat) {
                    var item = new vscode.CompletionItem(mat, vscode.CompletionItemKind.Value);
                    item.detail = '已定义材料';
                    return item;
                });
            }
            // 提取已定义的截面名
            if (linePrefix.includes('SECTION=')) {
                var secMatches = text.matchAll(/SECTION\/\d+,\s*(\w+)/g);
                var sections = new Set();
                for (var _b = 0, secMatches_1 = secMatches; _b < secMatches_1.length; _b++) {
                    var match = secMatches_1[_b];
                    sections.add(match[1]);
                }
                return Array.from(sections).map(function (sec) {
                    return new vscode.CompletionItem(sec, vscode.CompletionItemKind.Value);
                });
            }
            return undefined;
        }
    }, '=');
    // 5. 悬停提示 Provider
    var hoverProvider = vscode.languages.registerHoverProvider('mbsim', {
        provideHover: function (document, position) {
            var range = document.getWordRangeAtPosition(position, /[A-Z_]+/);
            if (!range)
                return undefined;
            var word = document.getText(range);
            var hoverInfo = {
                'QG': '广义坐标位置 (x, y, z, qw, qx, qy, qz)\n- 前3位：位置坐标\n- 后4位：姿态四元数',
                'INERTIAL': '惯性张量 (Ixx, Iyy, Izz, Ixy, Ixz, Iyz)',
                'FNODEA_RD': '柔性节点类型：旋转+位移 (Rotation + Displacement)',
                'PRECONFIG_VALID': '预配置有效性：0=无效，1=有效',
                'INT_HHT': 'Hilber-Hughes-Taylor 隐式积分器',
                'VISD': '粘性阻尼系数 (Viscous Damping)',
                'RayleighDampM': '瑞利阻尼质量系数',
                'RayleighDampK': '瑞利阻尼刚度系数'
            };
            if (hoverInfo[word]) {
                return new vscode.Hover(new vscode.MarkdownString(hoverInfo[word]));
            }
            return undefined;
        }
    });
    // 6. 诊断（错误检查）
    var diagnosticCollection = vscode.languages.createDiagnosticCollection('mbsim');
    var validateDocument = function (document) {
        if (document.languageId !== 'mbsim')
            return;
        var diagnostics = [];
        var text = document.getText();
        var lines = text.split('\n');
        lines.forEach(function (line, index) {
            // 检查未闭合的区块
            if (line.includes('[') && !line.includes(']') && !line.startsWith('!')) {
                var range = new vscode.Range(index, line.indexOf('['), index, line.length);
                diagnostics.push(new vscode.Diagnostic(range, '区块标记未闭合，格式应为 [BLOCKNAME]', vscode.DiagnosticSeverity.Error));
            }
            // 检查重复的ID
            var idMatch = line.match(/^(RIGIDBODY|FNODE|MATERIAL|SECTION|BEAMELE)\/(\d+)/);
            if (idMatch) {
                var type = idMatch[1];
                var id = idMatch[2];
                var regex = new RegExp("^".concat(type, "/").concat(id), 'gm');
                var matches = text.match(regex);
                if (matches && matches.length > 1) {
                    var range = new vscode.Range(index, 0, index, line.indexOf(','));
                    diagnostics.push(new vscode.Diagnostic(range, "\u91CD\u590D\u7684 ".concat(type, " ID: ").concat(id), vscode.DiagnosticSeverity.Error));
                }
            }
        });
        diagnosticCollection.set(document.uri, diagnostics);
    };
    // 监听文档变化
    vscode.workspace.onDidChangeTextDocument(function (e) {
        if (e.document.languageId === 'mbsim') {
            validateDocument(e.document);
        }
    });
    // 初始化验证打开的文件
    vscode.workspace.textDocuments.forEach(validateDocument);
    // 注册所有Provider
    context.subscriptions.push(blockProvider, keywordProvider, snippetProvider, contextProvider, hoverProvider, diagnosticCollection);
}
exports.activate = activate;
// 辅助函数：获取当前光标所在的区块
function getCurrentBlock(document, position) {
    var text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    var blocks = text.matchAll(/\[(.*?)\]/g);
    var currentBlock = null;
    for (var _i = 0, blocks_1 = blocks; _i < blocks_1.length; _i++) {
        var match = blocks_1[_i];
        var blockName = match[1];
        if (!blockName.startsWith('/')) {
            currentBlock = blockName;
        }
        else if (blockName === "/".concat(currentBlock)) {
            currentBlock = null;
        }
    }
    return currentBlock;
}
function deactivate() { }
exports.deactivate = deactivate;
