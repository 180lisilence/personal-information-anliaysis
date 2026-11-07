from abc import ABC, abstractmethod
from datetime import datetime
import os
import time
import aiohttp
import aiofiles
from utils.common import get_random_user_agent, match_one

class BaseParser(ABC):
    def __init__(self, task):
        parse_rules = task.get('parseValues', [])
        columns = {rule['key']: rule['index'] for rule in parse_rules}
        patterns = {rule['key']: rule['pattern'] for rule in parse_rules}

        self.columns = columns
        self.patterns = patterns
        self.url = task.get('url', '')
        self.children = task.get('children', [])
        self.maxCount = task.get('maxCount', 10)
        self.cookies = task.get('cookies', '')
        self.parseType = task.get('parseType', 0)
        self.other_rules = task['otherValues']
        self.content = None

    async def load_content(self, url):
        if url.startswith('file://'):
            file_path = url.replace('file://', '').replace('/', '\\')
            if os.path.isfile(file_path):
                async with aiofiles.open(file_path, 'r', encoding='utf-8') as file:
                    self.content = await file.read()
                print(f"已加载本地文件: {file_path}")
            else:
                raise FileNotFoundError(f"本地文件不存在: {file_path}")
        else:
            headers = {'User-Agent': get_random_user_agent(), 'Cookie': self.cookies}
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    response.raise_for_status()
                    self.content = await response.text()
                print(f"已加载URL: {url}")

    @abstractmethod
    async def parse(self, maxCount=None, context=None):
        """
        输出: 解析表格
        """
        pass

    def get_content(self):
        """
        输出: 网页源码
        """
        return self.content

    # 添加其他值
    def addOtherValues(self, data, html_content):
        print("========添加其他值...============")
        specialValues = self.getSpecialValues()
        result = []
        memo = {}
        if not data:
            data = [{}] # 如果data为空，则添加一个空字典用于其他值匹配

        for item in data:
            for rule in self.other_rules:
                if rule['valueType'] == 'fixed':
                    item[rule['source']] = rule['target']
                elif rule['valueType'] == 'regex':  # 只允许解析单个
                    if rule['source'] not in memo:
                        memo[rule['source']] = match_one(html_content, rule['target'])
                    value = memo[rule['source']]
                    item[rule['source']] = value
                elif rule['valueType'] == 'special':
                    value = specialValues.get(rule['target'])
                    if value is not None:
                        item[rule['source']] = value
                    else:
                        print(f"Key {rule['target']} not found in specialValues.")

            result.append(item)

        if result[0] == {}:
            return []   # 如果result为空，则返回空列表

        return result

    # 特殊值配置
    def getSpecialValues(self):
        current_timestamp = int(time.time())
        current_time_str = datetime.fromtimestamp(current_timestamp).strftime('%Y-%m-%d %H:%M:%S')
        specialValues = {
            'attack_time': current_time_str,
            'attack_timestamp': current_timestamp
        }
        return specialValues