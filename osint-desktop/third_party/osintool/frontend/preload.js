const { contextBridge, shell, ipcRenderer, dialog } = require('electron')
const { Titlebar, TitlebarColor } = require("custom-electron-titlebar");
const path = require('path');
const fs = require('fs');

const customColor = TitlebarColor.fromHex('#66B1FF');
window.addEventListener('DOMContentLoaded', () => {
    // Title bar implementation
    new Titlebar({
        backgroundColor: customColor,
        icon: '../logo.svg',
        // shadow: false
    });
});

const baseURL = 'http://localhost:5001'; // 后端服务器地址
const rootPath = path.resolve(__dirname, '..');  // 根目录
const showSaveDialog = (options) => {
    return new Promise((resolve) => {
        // 向主进程发送消息，请求显示保存对话框
        ipcRenderer.send('show-save-dialog', options);
        // 监听主进程返回的结果
        ipcRenderer.once('save-dialog-result', (event, result) => {
            resolve(result);
        });
    });
};

contextBridge.exposeInMainWorld('api', {
    // 获取所有任务
    getTasks: () => {
        return fetch(`${baseURL}/api/tasks`)
            .then(response => response.json())
    },

    getTasksBasic: () => {
        return fetch(`${baseURL}/api/tasks/basic`)
          .then(response => response.json())
    },

    // 获取分页任务
    getTasksPaginated: (params) => {
        // 将对象参数转为查询字符串
        const queryParams = new URLSearchParams(params).toString();
        return fetch(`${baseURL}/api/tasks/paginated?${queryParams}`)
            .then(response => response.json())
    },

    // 获取单个任务
    getTask: (taskId) => {
        return fetch(`${baseURL}/api/tasks/${taskId}`)
            .then(response => response.json())
    },

    // 创建任务
    createTask: (task) => {
        return fetch(`${baseURL}/api/tasks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(task)
        }).then(response => response.json())
    },

    // 更新任务
    updateTask: (taskId, task) => {
        return fetch(`${baseURL}/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(task)
        }).then(response => response.json())
    },

    // 删除任务
    deleteTask: (taskId) => {
        return fetch(`${baseURL}/api/tasks/${taskId}`, {
            method: 'DELETE'
        }).then(response => response.json())
    },

    updateTaskStatus: (taskId, isActive) => {
        return fetch(`${baseURL}/api/tasks/${taskId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isActive })
        }).then(response => response.json())
    },

    parseTask: (taskId) => {
        return fetch(`${baseURL}/api/tasks/${taskId}/parse`, {
            method: 'POST'
        }).then(response => response.json())
    },

    // 执行任务
    runTask: (taskId) => {
        return fetch(`${baseURL}/api/tasks/${taskId}/run`, {
            method: 'POST'
        }).then(response => response.json())
    },

    // 批量删除任务
    deleteTasks: (taskIds) => {
        return fetch(`${baseURL}/api/tasks/batch_delete`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskIds })
        }).then(response => response.json())
    },
    // 批量运行
    runTasks: (taskIds) => {
        return fetch(`${baseURL}/api/tasks/batch_start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskIds })
        }).then(response => response.json())
    },
    // 批量停止
    stopTasks: (taskIds) => {
        return fetch(`${baseURL}/api/tasks/batch_stop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskIds })
        }).then(response => response.json())
    },
    // 导入
    importTasks: (jsonData) => {
        return fetch(`${baseURL}/api/tasks/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(jsonData)
        }).then(response => response.json());
    },
    // 批量导出
    exportTasks: async (taskIds) => {
        const response = await fetch(`${baseURL}/api/tasks/batch_export`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ taskIds })
        });
        const data = await response.json();

        console.log(data);

        // 打开文件保存对话框
        const filePath = await showSaveDialog({
            title: '选择导出文件的保存位置',
            defaultPath: 'exported_tasks.json',
            filters: [
                { name: 'JSON Files', extensions: ['json'] }
            ]
        });

        if (!filePath) {
           return false;
        }
        console.log(filePath);

        try {
            // 将导出的数据写入文件
            fs.writeFileSync(filePath, JSON.stringify(data['tasks'], null, 2));
            return true;
        } catch (error) {
            console.error('导出文件时出错:', error);
            return false;
        }
    },
    // 打开根目录data/taskId
    openTaskResultFolder: (taskId) => {
        const rootPath = path.resolve(__dirname, '..');  // 根目录
        const taskPath = path.join(rootPath, 'data', taskId);  // 对应id的任务解析结果目录

        // 检查路径是否存在，如果不存在则创建
        if (!fs.existsSync(taskPath)) {
            try {
                fs.mkdirSync(taskPath, { recursive: true });
                console.log(`Created task result folder: ${taskPath}`);
            } catch (error) {
                console.error(`Failed to create task result folder: ${error.message}`);
                return false;
            }
        }

        shell.openPath(taskPath).then((error) => {
            if (error) {
                console.error('Failed to open folder:', error);
            }
        });
        return true;
    },
    // 上传脚本
    uploadScript: (id, file) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const scriptContent = e.target.result;
            const scriptDir = path.join(rootPath, 'script');
            const scriptPath = path.join(scriptDir, `${id}.py`);
            console.log(scriptPath);

            try {
                // 确保 script 文件夹存在
                fs.mkdirSync(scriptDir, { recursive: true });
                // 写入文件
                fs.writeFileSync(scriptPath, scriptContent, 'utf8');
            } catch (error) {
                console.error('Error writing script:', error);
                return false;
            }
        };
        reader.readAsText(file.raw);
        return true;
    },
    // 检查脚本是否存在
    checkScriptExists: (taskId) => {
        const scriptDir = path.join(rootPath, 'script');
        const scriptPath = path.join(scriptDir, `${taskId}.py`);
        return fs.existsSync(scriptPath);
    },
    openScriptFile: (id) => {
        const scriptDir = path.join(rootPath, 'script');
        const scriptPath = path.join(scriptDir, `${id}.py`);
        shell.openPath(scriptPath).then((error) => {
            if (error) {
                console.error('Failed to open script file:', error);
            }
        });
    },
    sendToRenderer: (channel, data) => ipcRenderer.send(channel, data),
    receiveFromMain: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args))
})