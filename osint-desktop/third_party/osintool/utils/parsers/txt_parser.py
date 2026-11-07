import re
from .base import BaseParser

class TXTParser(BaseParser):
    def __init__(self, task):
        super().__init__(task)
        self.table_pattern = task.get('table_pattern', '')

    async def parse(self, maxCount=0, context=None):
        """
        解析TXT文件并根据传入的 columns 和 patterns 进行处理。
        若parseType==0, 则通过 columns 根据索引定位列
        若parseType==1, 则通过 patterns 对列值进行正则处理
        使用正则匹配规则提取表格数据（这样的话，就不需要再对字段正则匹配了，但让其冗余吧）
        """
        if maxCount > 0:
            self.maxCount = maxCount

        await self.load_content(self.url)
        table = []
        lines = self.content.split('\n')  # 按行分割文件内容

        print("========正在匹配表格行============")

        # 遍历每一行
        for line in lines:
            line = line.strip()
            if not line:  # 跳过空行
                continue

            # 判断是否符合表格行的规则
            match = re.match(self.table_pattern, line)   # re.match 从开头匹配，部分匹配也算成功
            if match:
                # 通过正则匹配提取表格单元格数据
                row_data = match.groups()
                if row_data:
                    table.append(row_data)
                    if len(table) >= maxCount:
                        break

        print("========匹配表格行完成============")
        # 根据解析类型执行不同的处理
        if self.parseType == 0:  # 按列索引解析
            table = self.convert_to_dict_with_columns(table, self.columns)
        elif self.parseType == 1:  # 如果是正则匹配类型，进行正则处理
            table = self.convert_to_dict_with_patterns(table, self.patterns)

        table = self.addOtherValues(table, self.content)
        return table

    def convert_to_dict_with_columns(self, table, columns):
        """将二维数组转换为字典列表，使用 columns 来选择特定的列"""
        if not table:
            return []

        dict_list = []

        # 将每一行转换为字典
        for row in table:
            row_dict = {}

            # 使用 columns 映射索引并提取数据
            for key, index in columns.items():
                if index < len(row):  # 确保索引有效
                    row_dict[key] = row[index]

            dict_list.append(row_dict)

        return dict_list

    def convert_to_dict_with_patterns(self, table, patterns):
        """基于正则模式将整个表格转换为字典列表"""
        if not table:
            return []

        dict_list = []

        for row in table:
            row_str = ' '.join(map(str, row))  # 将整行数据拼接成字符串
            row_dict = {}

            # 使用正则表达式对每一列数据进行处理
            for key, pattern in patterns.items():
                row_dict[key] = self.apply_pattern(row_str, pattern)

            dict_list.append(row_dict)

        return dict_list

    def apply_pattern(self, value, pattern):
        """应用正则表达式对值进行处理"""
        try:
            # 进行正则匹配
            match = re.search(pattern, value)
            if match:
                return match.group(0)  # 返回第一个匹配结果
        except re.error:
            return value  # 如果正则表达式无效，则返回原值
        return value