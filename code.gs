function doGet(e) {
  var ss = SpreadsheetApp.openById("1AS-S0XLWgwG8bBhYGoC0plDxoB0UKPa8YOtsb8obxPE");
  var sheet = ss.getSheetByName("Sheet1") || ss.getSheets()[0];
  var action = e.parameter.action;

  if (action === "getRow") {
    var row = parseInt(e.parameter.row);
    var lastCol = sheet.getLastColumn();
    var rowData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    var data = {};
    for (var i = 0; i < lastCol; i++) {
      var colLetter = String.fromCharCode(65 + i);
      data[colLetter] = rowData[i] !== null && rowData[i] !== undefined ? rowData[i].toString() : "";
    }
    return ContentService.createTextOutput(JSON.stringify({ row: row, data: data }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "list") {
    var start = parseInt(e.parameter.start) || 2;
    var end = e.parameter.end ? parseInt(e.parameter.end) : sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var rows = [];
    for (var r = start; r <= end; r++) {
      var rowData = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
      var data = {};
      for (var i = 0; i < lastCol; i++) {
        var colLetter = String.fromCharCode(65 + i);
        data[colLetter] = rowData[i] !== null && rowData[i] !== undefined ? rowData[i].toString() : "";
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

  return ContentService.createTextOutput(JSON.stringify({ error: "Unknown action" }))
    .setMimeType(ContentService.MimeType.JSON);
}
