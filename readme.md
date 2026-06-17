# MBDyn Language Support 扩展使用说明

## 简介

MBDyn Language Support 是一个为 **MBDyn** 多体动力学仿真输入文件（通常以 `.mbs` 为扩展名）提供语法高亮、智能提示、错误检查、交叉引用验证以及便捷仿真工具支持的 Visual Studio Code 扩展。它能够显著提升 MBDyn 模型的开发效率，并集成了仿真程序版本管理、URDF 文件解析等功能。

## 功能特性

### 语法高亮与自动补全
- 支持 MBDyn 输入文件中所有关键字（如 `RIGIDBODY`、`FNODE`、`CONSTRAINT` 等）的高亮显示。
- 根据当前文件中的定义自动生成 **ID 序号**（如 `RIGIDBODY/1`）。
- 在输入参数时提供 **参数名补全**，并针对常见参数（如 `TYPE`、`QG`、`MATERIAL` 等）提供预设选项或 Snippet 片段，快速生成多值参数。

### 实时诊断与交叉引用验证
- 自动检测未定义的引用（如 `RIGIDBODY` 引用了不存在的 `GEOMETRY` 或 `MATERIAL`）。
- 支持 **多值参数** 的验证（例如 `BEAMELE` 的 `NODES` 参数可包含多个节点名，均会被检查）。
- 检查中文字符（MBDyn 输入文件建议使用纯英文）。
- 验证参数值类型（如质量、密度必须为非负数，`TYPE` 必须为合法选项等）。
- 检查注释符 `!` 是否位于行首（避免意外注释）。

### URDF 文件集成
- 自动解析工作区中所有的 `.urdf` 文件，将其中的 `<link name="...">` 和 `<joint name="...">` 分别作为刚体（RIGIDBODY）和约束（CONSTRAINT）的定义加入交叉引用集合，使 MBDyn 文件可以引用 URDF 中定义的名称。

### 悬停提示（Hover）
- 将鼠标悬停在已定义的引用名称上，可查看该名称的定义状态（已定义/未定义）以及所在集合。
- 悬停在参数名上可查看该参数的详细说明（如 `QG` 的含义）。
- 悬停在关键字上可查看该关键字的描述和可用参数列表。

### 扩展与仿真器自更新
- **扩展自更新**：自动检查 GitHub 仓库（`xxjxxj288/MBDy_vscode`）是否有新版本发布，用户可通过状态栏按钮或命令手动检查更新，并支持一键下载安装 `.vsix` 文件。
- **仿真器版本管理**：自动检查 MBDyn 仿真程序（`xxjxxj288/MBdyn` 仓库）的更新，当本地程序文件名与最新发布文件名不一致时提示用户下载新版本。

### 便捷仿真工具
- **一键运行仿真**：将当前编辑的 MBS 文件保存为 `DefaultConfig.mbs`，并生成批处理脚本调用配置的仿真程序路径启动仿真。
- **一键打开 ParaView**：如果仿真输出了 Ensight 格式结果，可直接通过状态栏按钮用 ParaView 打开对应的 `.case` 文件。
- **状态栏快捷按钮**：提供运行仿真、打开 ParaView、配置路径、检查更新等快捷操作。

### 配置管理
- 可通过 VS Code 设置或命令面板配置仿真程序路径和 ParaView 路径。
- 支持配置自动检查更新的开关。

## 安装

### 从 VSIX 文件手动安装
1. 在 VS Code 扩展视图右上角菜单选择 “从 VSIX 安装...”。
2. 选择下载的 `.vsix` 文件。


## 配置

### 设置项
扩展提供以下可配置项（通过 `文件 → 首选项 → 设置`，搜索 “mbsim” 即可找到）：

| 配置键 | 说明 | 默认值 |
|--------|------|--------|
| `mbsim.simulator.path` | MBDyn 仿真程序可执行文件的完整路径。 | `"simulator.exe"`（扩展中下载的MBdyn会自动配置，也可手动配置） |
| `mbsim.paraview.path` | ParaView 可执行文件的完整路径。 | `"paraview"`（需用户配置） |
| `mbsim.simulator.autoCheckUpdates` | 是否自动检查仿真程序更新。 | `true` |
| `mbsim.extension.autoCheckUpdates` | 是否自动检查扩展本身更新。 | `true` |

### 快速配置
可通过状态栏的齿轮图标 `配置` 按钮或命令面板（Ctrl+Shift+P）输入 ` 配置` 来快速设置上述路径。


## 使用方法

### 创建 MBDyn 输入文件
- 新建文件，语言模式选择 “MBSIM”（如果文件扩展名为 `.mbs`，会自动识别）。
- 开始输入关键字（如 `RIGIDBODY`），扩展会自动补全并生成递增的 ID。

### 编写模型
每个定义块格式：`关键字/ID, 名称, 参数1=值, 参数2=值, ...`。
示例：
```plaintext
RIGIDBODY/1, body1, MASS=10.0, INERTIAL=0.1,0.1,0.1,0,0,0, QG=0,0,0,1,0,0,0, GEOMETRY=geom1
GEOMETRY/1, geom1, TYPE=BOX, LENGTHS=1,2,3