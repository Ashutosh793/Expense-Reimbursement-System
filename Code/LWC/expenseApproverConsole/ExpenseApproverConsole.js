import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';

import getMyPendingApprovals from '@salesforce/apex/ExpenseApproverConsoleController.getMyPendingApprovals';
import getClaimDetails from '@salesforce/apex/ExpenseApproverConsoleController.getClaimDetails';
import approveWorkItem from '@salesforce/apex/ExpenseApproverConsoleController.approveWorkItem';
import rejectWorkItem from '@salesforce/apex/ExpenseApproverConsoleController.rejectWorkItem';

export default class ExpenseApproverConsole extends LightningElement {
    @track rows = [];
    @track details;

    selected; // selected approval row
    comment = '';
    busy = false;

    // wired result handle for refreshApex
    wiredResult;

    columns = [
        { label: 'Claim', fieldName: 'claimName' },
        { label: 'Employee', fieldName: 'employeeName' },
        { label: 'Total', fieldName: 'totalExpenseAmount', type: 'currency' },
        { label: 'Status', fieldName: 'status' },
        { label: 'Assigned To', fieldName: 'assignedTo' },
        { label: 'Submitted', fieldName: 'submitDate', type: 'date' },
        {
            type: 'button',
            fixedWidth: 110,
            typeAttributes: { label: 'View', name: 'view', variant: 'neutral' }
        }
    ];

    lineItemColumns = [
        { label: 'Type', fieldName: 'Expense_Type__c' },
        { label: 'Date', fieldName: 'Expense_Date__c', type: 'date' },
        { label: 'Amount', fieldName: 'Amount__c', type: 'currency' },
        { label: 'Merchant', fieldName: 'Merchant__c' },
        { label: 'Receipt Req', fieldName: 'Receipt_Required__c', type: 'boolean' },
        { label: 'Receipt OK', fieldName: 'Receipt_Attached__c', type: 'boolean' }
    ];

    @wire(getMyPendingApprovals)
    wiredApprovals(result) {
        this.wiredResult = result;

        if (result.data) {
            this.rows = result.data;

            // If previously selected work item no longer exists, close panel
            if (this.selected) {
                const stillThere = this.rows.find(
                    (r) => r.workItemId === this.selected.workItemId
                );
                if (!stillThere) {
                    this.closeDetailsPanel();
                }
            }
        } else if (result.error) {
            this.toastError(result.error);
        }
    }

    // Safe getter for employee name inside details panel
    get employeeNameSafe() {
        return this.details?.claim?.Employee__r?.Name || '—';
    }

    get hasReceipts() {
        return (this.details?.receipts?.length || 0) > 0;
    }

    get claimRecordUrl() {
        if (!this.details?.claim?.Id) return '#';
        return `/lightning/r/Expense_Claim__c/${this.details.claim.Id}/view`;
    }

    onComment = (e) => {
        this.comment = e.target.value;
    };

    // Refresh button handler
    async loadApprovals() {
        try {
            this.busy = true;
            await refreshApex(this.wiredResult);
        } catch (e) {
            this.toastError(e);
        } finally {
            this.busy = false;
        }
    }

    async handleRowAction(event) {
        const action = event.detail.action.name;
        const row = event.detail.row;

        if (action === 'view') {
            try {
                this.busy = true;
                this.selected = row;
                this.comment = '';
                this.details = null;

                const d = await getClaimDetails({ claimId: row.claimId });
                this.details = d;
            } catch (e) {
                this.details = null;
                this.toastError(e);
            } finally {
                this.busy = false;
            }
        }
    }

    async approve() {
        if (!this.selected?.workItemId) return;
        try {
            this.busy = true;

            await approveWorkItem({
                workItemId: this.selected.workItemId,
                comments: this.comment
            });

            this.toast('Approved', 'Approval completed.', 'success');

            // Close the panel immediately after action
            this.closeDetailsPanel();

            // Refresh list (removes the approved item)
            await refreshApex(this.wiredResult);
        } catch (e) {
            this.toastError(e);
        } finally {
            this.busy = false;
        }
    }

    async reject() {
        if (!this.selected?.workItemId) return;

        if (!this.comment || !this.comment.trim()) {
            this.toast('Comment required', 'Please add rejection comments.', 'warning');
            return;
        }

        try {
            this.busy = true;

            await rejectWorkItem({
                workItemId: this.selected.workItemId,
                comments: this.comment
            });

            this.toast('Rejected', 'Rejection submitted.', 'success');

            // Close the panel immediately after action
            this.closeDetailsPanel();

            // Refresh list (removes the rejected item)
            await refreshApex(this.wiredResult);
        } catch (e) {
            this.toastError(e);
        } finally {
            this.busy = false;
        }
    }

    closeDetailsPanel() {
        this.details = null;
        this.selected = null;
        this.comment = '';
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    toastError(err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.toast('Error', msg, 'error');
    }
}
