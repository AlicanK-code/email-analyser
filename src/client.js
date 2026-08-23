// first button 
const myButton = document.getElementById('btn');
const table = document.getElementById('emailTable');
const tableBody = document.getElementById('tableBody');

myButton.addEventListener('click', async () => {
    btn.innerText="Loading...";
    btn.disabled = true;
    //console.log("Button clicked! Telling the server to scan...");
    
    try {
        const response = await fetch('/data');
        const data = await response.json(); // Array of {Domain, Count}

        // Clears previous results of table
        tableBody.innerHTML = "";

        // loops through each item in the array
        data.forEach(item => {
            const row = `
            <tr>
                <td>${item.Domain}</td>
                <td><span class="badge bg-secondary">${item.Count}</span></td>
            </tr>`;
            // increment rows based on no. items
            tableBody.innerHTML += row;
        });

        table.style.display ="table";
        btn.innerText = "Complete";

        // Set timer to change button back to "Retrieval"
        window.setTimeout(() => {
            btn.innerText = "Retrieve";
            btn.disabled = false;
        }, 1000);


    } catch (err) {
        console.log("Fetch error: ", err);
        btn.innerText = "Error";
        btn.disabled = false;
    }


});