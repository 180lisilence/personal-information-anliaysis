import asyncio
import random
from flask import Flask, jsonify, request
from flask_cors import CORS
from tinydb import TinyDB, Query
import json
from datetime import datetime
import os
import shortuuid
from utils.parser_factory import ParserFactory
from utils.logger import setup_logger
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# https://regex101.com/

app = Flask(__name__)
CORS(app)

# 初始化 TinyDB
db = TinyDB('db.json')
tasks_table = db.table('tasks')

# 初始化调度器
scheduler = AsyncIOScheduler()
# 初始化日志
logger = setup_logger()
# 自定义日志记录器，添加 API 信息
class ApiInfoFilter(logging.Filter):
    def filter(self, record):
        if request:
            record.api_info = request.path
        else:
            record.api_info = "N/A"
        return True

logger.addFilter(ApiInfoFilter())

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    try:
        tasks = tasks_table.all()
        logger.info(f"成功获取所有任务，数量：{len(tasks)}")
        return jsonify(tasks)
    except Exception as e:
        logger.error(f"获取所有任务时出错: {e}")
        return jsonify({"error": "获取任务时出错"}), 500

@app.route('/api/tasks/basic', methods=['GET'])
def get_basic_tasks():
    try:
        tasks = tasks_table.all()
        # 只返回必要的字段（用于edit.html）
        necessary_fields = ['id', 'title', 'isActive']
        result = []
        for task in tasks:
            filtered_task = {field: task.get(field) for field in necessary_fields}
            result.append(filtered_task)
        logger.info(f"成功获取所有任务的基本信息，数量：{len(tasks)}")
        return jsonify(result)
    except Exception as e:
        logger.error(f"获取所有任务的基本信息时出错: {e}")
        return jsonify({"error": "获取任务时出错"}), 500

@app.route('/api/tasks/paginated', methods=['GET'])
def get_tasks_paginated():
    # 获取分页、搜索、排序和筛选参数
    logger.info(f"分页请求参数: {request.args}")
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('perPage', 10))
        search = request.args.get('searchQuery', '').lower()

        sort = json.loads(request.args.get('sort', '[]'))   # 是一个对象sort= [{ sortField: 'title', sortOrder: 'asc' }]

        filters = json.loads(request.args.get('filters', '{}'))    # 是一个对象filters = { scheduleType: ['fixed'] }

        # 调试输出
        print(f"Page: {page}, Per Page: {per_page}, Search: {search}, Sort: {sort}, Filters: {filters}")

        # 获取所有任务
        tasks = tasks_table.all()

        # 搜索过滤
        if search:
            tasks = [t for t in tasks if search in t.get('title', '').lower() or search in t.get('url', '').lower()]

        # 筛选过滤, filters = { scheduleType: ['fixed'], ... }
        if filters:
            for field, values in filters.items():
                if values:
                    tasks = [t for t in tasks if t.get(field) in values]

        # 排序处理
        if sort:
            for cond in reversed(sort):
                field, order = cond.get("sortField"), cond.get("sortOrder", "asc")
                placeholder = ''
                tasks.sort(key=lambda t: placeholder if t.get(field) is None else t.get(field), reverse=(order == "desc"))

        # 分页处理
        start, end, total = (page - 1) * per_page, (page - 1) * per_page + per_page, len(tasks)
        paginated_tasks = tasks[start:end]

        return jsonify({
            'page': page,
            'perPage': per_page,
            'total': total,
            'data': paginated_tasks
        })
    except Exception as e:
        logger.error(f"获取分页任务时出错: {e}")
        return jsonify({"error": "获取任务时出错"}), 500

@app.route('/api/tasks', methods=['POST'])
async def create_task():
    try:
        data = request.json
        task_id = str(shortuuid.uuid())
        data['id'] = task_id
        tasks_table.insert(data)
        if data.get('isActive', True):
            schedule_task(data)
        logger.info(f"创建任务成功, ID: {task_id}")
        return jsonify({'id': task_id}), 201
    except Exception as e:
        logger.error(f"创建任务时出错: {e}")
        return jsonify({"error": "创建任务时出错"}), 500

@app.route('/api/tasks/<string:task_id>', methods=['GET'])
def get_task(task_id):
    Task = Query()
    task = tasks_table.get(Task.id == task_id)
    if task is None:
        logger.warning(f"任务 {task_id} 未找到")
        return jsonify({'error': 'Task not found'}), 404
    logger.info(f"获取任务成功, ID: {task_id}")
    return jsonify(task)

@app.route('/api/tasks/<string:task_id>', methods=['PUT'])
async def update_task(task_id):
    try:
        data = request.json
        Task = Query()
        tasks_table.update(data, Task.id == task_id)
        if scheduler.get_job(task_id):
            scheduler.remove_job(task_id)   # 先删除原有任务
        if data.get('isActive', False) == True:
            schedule_task(data)
        logger.info(f"更新任务成功, ID: {task_id}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"更新任务时出错: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks/<string:task_id>', methods=['DELETE'])
def delete_task(task_id):
    try:
        Task = Query()
        tasks_table.remove(Task.id == task_id)
        if scheduler.get_job(task_id):
            scheduler.remove_job(task_id)
        logger.info(f"删除任务成功, ID: {task_id}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"删除任务时出错: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# 批量删除
@app.route('/api/tasks/batch_delete', methods=['DELETE'])
def delete_tasks():
    try:
        data = request.json
        ids = data.get('taskIds', [])
        tasks_table.remove(Query().id.one_of(ids))
        for task_id in ids:
            if scheduler.get_job(task_id):
                scheduler.remove_job(task_id)
        logger.info(f"批量删除任务成功, IDs: {ids}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"批量删除任务失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/tasks/<string:task_id>/status', methods=['PUT'])
async def update_task_status(task_id):
    try:
        data = request.json
        isActive = data.get('isActive', False)
        await update_task_status_func(task_id, isActive)
        logger.info(f"更新任务状态成功, ID: {task_id}, 运行中: {isActive}")
        print(f"更新任务状态成功, ID: {task_id}, 运行中: {isActive}")
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"更新任务状态失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

async def update_task_status_func(task_id, isActive):
    Task = Query()
    # 获取当前任务的状态
    task = tasks_table.get(Task.id == task_id)
    current_is_active = task.get('isActive', False) if task else False
    # 检查当前状态和传入的状态是否一致
    if current_is_active != isActive:
        tasks_table.update({'isActive': isActive}, Task.id == task_id)
        if isActive:
            task = tasks_table.get(Task.id == task_id)
            schedule_task(task)
        else:
            if scheduler.get_job(task_id):
                scheduler.remove_job(task_id)

# 获取运行中的任务
# def get_running_tasks():
#     jobs = scheduler.get_jobs()
#     running_tasks = [{'id': job.id, 'next_run_time': job.next_run_time } for job in jobs]
#     return jsonify({'success': True, 'running_tasks': running_tasks})

@app.route('/api/tasks/<string:task_id>/parse', methods=['POST'])
async def parse_task(task_id):    # 预览
    Task = Query()
    task = tasks_table.get(Task.id == task_id)
    if not task:
        logger.warning(f"任务 {task_id} 未找到")
        return jsonify({'success': False, 'error': '任务不存在'}), 404

    max_count = min(task['maxCount'], 20)  # 最大返回20条数据
    try:
        table = await execute_task_parsing(task, max_count)
        logger.info(f"预览任务解析成功, ID: {task_id}")
        return jsonify({'success': True, 'table': table})
    except Exception as e:
        logger.error(f"预览任务解析失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/tasks/<string:task_id>/run', methods=['POST'])
async def run_task(task_id):
    Task = Query()
    task = tasks_table.get(Task.id == task_id)
    if not task:
        logger.warning(f"任务 {task_id} 未找到")
        return jsonify({'success': False, 'error': '任务不存在'}), 404

    print(f'===========正在运行任务: {task_id}============')

    if task['crawlMode'] == 'pro':  # 专家模式
        # 找到根目录/script/{id}.py
        script_path = os.path.join('script', f'{task_id}.py')
        if not os.path.exists(script_path):
            logger.warning(f"脚本 {script_path} 未找到")
            return jsonify({'success': False, 'error': '脚本文件不存在'}), 404
        os.system(f'python {script_path}')  # 运行脚本
        logger.info(f"任务 {task_id} 运行成功（专家模式）")
        return jsonify({'success': True, 'message': '任务已成功运行'})

    # 普通模式(task['crawlMode'] == 'general')

    os.makedirs('data', exist_ok=True)

    max_count = task['maxCount']  # 获取最大数据量
    try:
        result = await execute_task_parsing(task, max_count)

        # 保存结果
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        formatted_time = current_time.replace(' ', '_').replace(':', '.')
        filename = f'{formatted_time}.json'
        output_dir = os.path.join('data', str(task_id))
        os.makedirs(output_dir, exist_ok=True)
        filepath = os.path.join(output_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        # 更新任务的 lastRunTime
        Task = Query()
        tasks_table.update({'lastRunTime': current_time}, Task.id == task_id)

        logger.info(f"任务 {task_id} 运行成功， 运行时间: {current_time}")
        return jsonify({
            'success': True,
            'task': {
                'id': task['id'],
                'lastRunTime': current_time,
                'resultFile': filename
            }
        })
    except Exception as e:
        logger.error(f"任务 {task_id} 运行失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

#批量启动
@app.route('/api/tasks/batch_start', methods=['POST'])
def batch_start_tasks():
    try:
        data = request.json
        task_ids = data.get('taskIds', [])
        for task_id in task_ids:
            update_task_status_func(task_id, True)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"批量启动任务失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

#批量停止
@app.route('/api/tasks/batch_stop', methods=['POST'])
def batch_stop_tasks():
    try:
        data = request.json
        task_ids = data.get('taskIds', [])
        for task_id in task_ids:
            update_task_status_func(task_id, False)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"批量停止任务失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# 批量导出
@app.route('/api/tasks/batch_export', methods=['POST'])
def batch_export_tasks():
    try:
        data = request.json
        task_ids = data.get('taskIds', [])
        if not task_ids:
            logger.warning(f"未提供任务ID")
            return jsonify({'success': False, 'error': 'No task IDs provided'}), 400

        Task = Query()
        tasks = tasks_table.search(Task.id.one_of(task_ids))
        return jsonify({"success": True, "tasks": tasks})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 通过json导入
@app.route('/api/tasks/import', methods=['POST'])
def import_tasks():
    try:
        # 获取请求中的 JSON 数据
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
        if not isinstance(data, list):
            return jsonify({"error": "Invalid JSON data format, must be list"}), 400
        # 定义一个样本任务，可根据实际情况调整
        sample_task = {"cookies": "", "crawlMode": "general", "dataFormat": "html", "days": 1, "execTime": "00:00",
                       "id": "", "interval": 1, "isActive": False, "lastRunTime": "", "maxCount": 1,
                       "next_run_time": None, "title": "", "url": "", "scheduleType": "random",
                       "table_pattern": "", "schedule": "", "tableType": "0",
                       "xpaths": {"next_page": "", "row": "", "table": ""},
                       "parseValues": [], "otherValues": [], "parseType": 1,
                       "before_action_group": [], "children": []}

        for task in data:
            task_id = task.get('id')
            if task_id:
                existing_task = tasks_table.get(Query().id == task_id)
                if existing_task:
                    print(f"任务 {task_id} 已存在，跳过导入")
                    continue
            # 遍历样本任务的字段，将缺失的字段设为空
            for field, default_value in sample_task.items():
                if field not in task:
                    task[field] = default_value

            tasks_table.insert(task)

        return jsonify({"success": True, "message": "Tasks imported successfully"}), 200
    except Exception as e:
        logger.error(f"导入任务失败: {e}")
        return jsonify({"error": str(e)}), 500

async def execute_task_parsing(task, max_count):
    # 根据数据格式初始化解析器
    parser = ParserFactory.get_parser(task)
    result = await parser.parse(max_count, context=None)
    return result

async def run_scheduled_task(task_id):
    with app.app_context():
        await run_task(task_id)
        job = scheduler.get_job(task_id)
        if job:
            next_run_time = job.trigger.get_next_fire_time(None, datetime.now().astimezone())   # 获取下一次运行时间(以当前系统时区为准)
            next_run_time_str = next_run_time.strftime('%Y-%m-%d %H:%M:%S') if next_run_time else None
            Task = Query()
            tasks_table.update({'next_run_time': next_run_time_str}, Task.id == task_id)

            print(f"任务 {task_id} 已运行, 下次运行时间: {next_run_time_str}")
        else:
            print(f"未找到任务 {task_id} 的调度信息")

def schedule_task(task):
    task_id = task['id']
    schedule_type = task['scheduleType']
    job = None
    if schedule_type == 'fixed':
        days = task['days']
        exec_time = task['execTime']
        hour, minute = map(int, exec_time.split(':'))
        job = scheduler.add_job(run_scheduled_task, 'cron', day=f'*/{days}', hour=hour, minute=minute, id=task_id, kwargs={'task_id': task_id})
    elif schedule_type == 'interval':
        interval = task['interval']
        job = scheduler.add_job(run_scheduled_task, 'interval', minutes=interval, id=task_id, kwargs={'task_id': task_id})
    elif schedule_type == 'random':
        interval = random.randint(1, 4096)  # 1 - 4096 分钟之间的随机值
        job = scheduler.add_job(run_scheduled_task, 'interval', minutes=interval, id=task_id, kwargs={'task_id': task_id})

    # 更新任务的 next_run_time
    if job:
        next_run_time = job.trigger.get_next_fire_time(None, datetime.now().astimezone())   # 获取下一次运行时间(以当前系统时区为准)
        next_run_time_str = next_run_time.strftime('%Y-%m-%d %H:%M:%S') if next_run_time else None
        Task = Query()
        tasks_table.update({'next_run_time': next_run_time_str}, Task.id == task_id)

    print(f"已添加定时任务: {task_id}")
    print(f"任务详情: {task}")

def init_scheduler():
    print("初始化调度器...")
    tasks = tasks_table.all()
    for task in tasks:
        if task.get('isActive', True):
            schedule_task(task)

# AsyncIOScheduler 依赖于 asyncio 的事件循环来运行异步任务，需要启动事件循环
async def main():
    init_scheduler()
    scheduler.start()
    # 启动 Flask 应用
    import threading
    def run_flask_app():
        app.run(debug=False, port=5001, threaded=True)

    flask_thread = threading.Thread(target=run_flask_app)
    flask_thread.start()

    try:
        while True:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()

if __name__ == '__main__':
    asyncio.run(main())
