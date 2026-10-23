"""Names of files and folders for the assistant's chat (`core.labels`)."""

from semestra.core.labels import owned_names, resolver
from semestra.modules.files.models import FilesFolder, FilesItem

item = owned_names(FilesItem, lambda row: row.display_name)
resolver("item", module="files")(item)
resolver("file_item")(item)

folder = owned_names(FilesFolder, lambda row: row.name)
resolver("parent", module="files")(folder)
resolver("folder")(folder)
