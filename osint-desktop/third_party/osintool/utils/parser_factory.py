from .parsers.html_parser import HTMLParser
from .parsers.txt_parser import TXTParser
from .parsers.csv_parser import CSVParser

class ParserFactory:
    _parsers = {
        'html': HTMLParser,
        'txt': TXTParser,
        'csv': CSVParser
    }

    @classmethod
    def get_parser(cls, task):
        """获取指定格式的解析器实例"""
        format_type = task.get('dataFormat', '').lower()
        parser_class = cls._parsers.get(format_type)
        if not parser_class:
            raise ValueError(f'Unsupported format: {format_type}')
        try:
            return parser_class(task)
        except Exception as e:
            raise ValueError(f'Failed to create parser for format {format_type}: {str(e)}')

    # @classmethod
    # def register_parser(cls, format_type, parser_class):
    #     """注册新的解析器"""
    #     cls._parsers[format_type.lower()] = parser_class