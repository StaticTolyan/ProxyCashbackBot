// This file contains functions that are executed in the context of web pages

// Function to create and display a red block notification
function getRedBlock(textHtml) {
    createBlock(textHtml);
}

// Function to create and display a green block notification
function getGreenBlock(textHtml) {
    createBlock(textHtml);
}

// Helper function to create the notification block
function createBlock(html) {
    var block = document.getElementById("cashback-block");

    if(block !== null){
        block.remove();
    }

    var div = document.createElement('div');
    div.id = "cashback-block";
    div.innerHTML = html;
    document.body.appendChild(div);
    document.getElementById("close-btn-line").onclick = function() {closeLine(); return false;};
}

// Function to close the notification
function closeLine() {
    var element = document.getElementById("cashback-info");
    if(element !== null){
        element.style.display = 'none';
        // element.parentNode.removeChild(element);
    }
}

// Make functions available to the content script context
window.getRedBlock = getRedBlock;
window.getGreenBlock = getGreenBlock;