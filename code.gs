function doGet(e) {
  var ss = SpreadsheetApp.openById("1AS-S0XLWgwG8bBhYGoC0plDxoB0UKPa8YOtsb8obxPE");
  var sheet = ss.getSheetByName("Sheet1") || ss.getSheets()[0];
  var action = e.parameter.action;

  if (action === "getRow") {
    var row = parseInt(e.parameter.row);
    var lastCol = sheet.getLastColumn();
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    var tz = ss.getSpreadsheetTimeZone();
    var data = {};
    for (var i = 0; i < lastCol; i++) {
      var colLetter = String.fromCharCode(65 + i);
      data[colLetter] = formatCellValue(rowData[i], tz);
    }
    return ContentService.createTextOutput(JSON.stringify({ row: row, data: data }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "list") {
    var start = parseInt(e.parameter.start) || 2;
    var end = e.parameter.end ? parseInt(e.parameter.end) : sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var tz2 = ss.getSpreadsheetTimeZone();
    var rows = [];
    for (var r = start; r <= end; r++) {
      var rowData = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
      var data = {};
      for (var i = 0; i < lastCol; i++) {
        var colLetter = String.fromCharCode(65 + i);
        data[colLetter] = formatCellValue(rowData[i], tz2);
      }
      rows.push({ row: r, data: data });
    }
    return ContentService.createTextOutput(JSON.stringify({ rows: rows }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "updateCell") {
    var row = parseInt(e.parameter.row);
    var col = e.parameter.col;
    var value = e.parameter.value;
    var colIndex = col.charCodeAt(0) - 64;
    sheet.getRange(row, colIndex).setValue(value);
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Cell " + col + row + " updated to " + value }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "highlightCell") {
    var row = parseInt(e.parameter.row);
    var col = e.parameter.col;
    var color = e.parameter.color || "#4CAF50";
    var colIndex = col.charCodeAt(0) - 64;
    sheet.getRange(row, colIndex).setBackground(color);
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Cell " + col + row + " highlighted " + color }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "highlightRange") {
    var row = parseInt(e.parameter.row);
    var cols = e.parameter.cols.split(",");
    var color = e.parameter.color || "#4CAF50";
    for (var i = 0; i < cols.length; i++) {
      var colIndex = cols[i].trim().charCodeAt(0) - 64;
      sheet.getRange(row, colIndex).setBackground(color);
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Row " + row + " cols " + cols.join(",") + " highlighted " + color }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ error: "Unknown action" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Format a cell value for JSON output.
 * Dates are returned as DD/MM/YYYY strings to preserve the sheet's format.
 */
function formatCellValue(val, tz) {
  if (val === null || val === undefined || val === "") return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, tz, "dd/MM/yyyy");
  }
  return val.toString();
}
