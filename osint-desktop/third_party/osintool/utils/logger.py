import logging
import os

# 配置日志记录
def setup_logger(log_file='log.txt', log_level=logging.INFO):
    logger = logging.getLogger(__name__)
    logger.setLevel(log_level)

    # 创建文件处理器
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(log_level)

    # 创建格式化器并添加到处理器，包含 API 信息
    formatter = logging.Formatter('%(asctime)s - %(api_info)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)

    # 将处理器添加到 logger
    logger.addHandler(file_handler)

    # 清理日志
    clean_logs(log_file)

    return logger

# 清理日志，默认保留 500 行
def clean_logs(log_file='log.txt', max_lines=500):
    if os.path.exists(log_file):
        with open(log_file, 'r', encoding='utf-8') as f:
            logs = f.readlines()
        # 只保留最后 500 行日志
        new_logs = logs[-max_lines:]

        # 将过滤后的日志重新写入文件
        with open(log_file, 'w', encoding='utf-8') as f:
            f.writelines(new_logs)