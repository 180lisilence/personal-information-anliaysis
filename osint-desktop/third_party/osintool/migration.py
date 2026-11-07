from tinydb import TinyDB

# 打开数据库文件
db = TinyDB('db.json')

# 获取所有任务
tasks = db.table('tasks')

# 遍历每个任务
for task in tasks:
    if 'children' not in task:
        task['children'] = []
        # 更新数据库中的任务
        tasks.update(task, doc_ids=[task.doc_id])

print("数据迁移完成。")
