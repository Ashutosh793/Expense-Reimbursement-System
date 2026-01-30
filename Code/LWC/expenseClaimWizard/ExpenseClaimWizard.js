import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Picklist (Cost Center) support
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import EXPENSE_CLAIM_OBJECT from '@salesforce/schema/Expense_Claim__c';
import COST_CENTER_FIELD from '@salesforce/schema/Expense_Claim__c.Cost_Center__c';

// Apex
import createDraftClaim from '@salesforce/apex/ExpenseClaimWizardController.createDraftClaim';
import getClaim from '@salesforce/apex/ExpenseClaimWizardController.getClaim';
import getLineItems from '@salesforce/apex/ExpenseClaimWizardController.getLineItems';
import addLineItemApex from '@salesforce/apex/ExpenseClaimWizardController.addLineItem';
import deleteLineItem from '@salesforce/apex/ExpenseClaimWizardController.deleteLineItem';
import submitClaimForApproval from '@salesforce/apex/ExpenseClaimWizardController.submitClaimForApproval';

export default class ExpenseClaimWizard extends LightningElement {
    @track currentStep = '1';

    // Step 1
    costCenter = '';
    justification = '';

    // Cost Center picklist
    recordTypeId;
    costCenterOptions = [];

    // Claim state
    claimId;
    claimName = '';
    claimStatus = '';
    totalAmount;
    @track lineItems = [];

    // Line item draft inputs
    liType = '';
    liDate = '';
    liAmount = '';
    liMerchant = '';
    liDesc = '';

    submitted = false;

    columns = [
        { label: 'Type', fieldName: 'Expense_Type__c' },
        { label: 'Date', fieldName: 'Expense_Date__c', type: 'date' },
        { label: 'Amount', fieldName: 'Amount__c', type: 'currency' },
        { label: 'Merchant', fieldName: 'Merchant__c' },
        { label: 'Receipt Required', fieldName: 'Receipt_Required__c', type: 'boolean' },
        { label: 'Receipt Attached', fieldName: 'Receipt_Attached__c', type: 'boolean' },
        {
            type: 'button',
            fixedWidth: 120,
            typeAttributes: { label: 'Delete', name: 'delete', variant: 'destructive' }
        }
    ];

    get expenseTypeOptions() {
        return [
            { label: 'Meals', value: 'Meals' },
            { label: 'Travel', value: 'Travel' },
            { label: 'Hotel', value: 'Hotel' },
            { label: 'Supplies', value: 'Supplies' },
            { label: 'Other', value: 'Other' }
        ];
    }

    // --------------------------
    // Picklist wiring (Cost Center)
    // --------------------------
    @wire(getObjectInfo, { objectApiName: EXPENSE_CLAIM_OBJECT })
    objInfo({ data, error }) {
        if (data) this.recordTypeId = data.defaultRecordTypeId;
        if (error) this.toastError(error);
    }

    @wire(getPicklistValues, { recordTypeId: '$recordTypeId', fieldApiName: COST_CENTER_FIELD })
    pickVals({ data, error }) {
        if (data) this.costCenterOptions = data.values;
        if (error) this.toastError(error);
    }

    // Step helpers
    get isStep1() { return this.currentStep === '1'; }
    get isStep2() { return this.currentStep === '2'; }
    get isStep3() { return this.currentStep === '3'; }
    get isStep4() { return this.currentStep === '4'; }
    get isFirst() { return this.currentStep === '1'; }
    get lineItemCount() { return (this.lineItems || []).length; }

    get nextDisabled() {
        if (this.isStep1) return !(this.costCenter && this.justification);
        if (this.isStep2) return !(this.claimId && this.lineItemCount > 0);
        if (this.isStep3) return !this.claimId;
        return false;
    }

    // Step 1 handlers
    onCostCenterPicklist = (e) => { this.costCenter = e.detail.value; };
    onJustification = (e) => { this.justification = e.target.value; };

    // Step 2 handlers
    onLiType = (e) => { this.liType = e.detail.value; };
    onLiDate = (e) => { this.liDate = e.target.value; };
    onLiAmount = (e) => { this.liAmount = e.target.value; };
    onLiMerchant = (e) => { this.liMerchant = e.target.value; };
    onLiDesc = (e) => { this.liDesc = e.target.value; };

    async next() {
        try {
            if (this.isStep1) {
                // Create draft claim once
                const id = await createDraftClaim({
                    costCenter: this.costCenter,
                    justification: this.justification
                });
                this.claimId = id;
                await this.refreshClaimAndItems();
                this.currentStep = '2';
                return;
            }
            if (this.isStep2) {
                await this.refreshClaimAndItems();
                this.currentStep = '3';
                return;
            }
            if (this.isStep3) {
                await this.refreshClaimAndItems();
                this.currentStep = '4';
                return;
            }
        } catch (err) {
            this.toastError(err);
        }
    }

    back() {
        if (this.isStep2) this.currentStep = '1';
        else if (this.isStep3) this.currentStep = '2';
        else if (this.isStep4) this.currentStep = '3';
    }

    async addLineItem() {
        try {
            if (!this.claimId) {
                this.toast('Create claim first', 'Please complete Step 1 first.', 'warning');
                return;
            }
            if (!(this.liType && this.liDate && this.liAmount)) {
                this.toast('Missing fields', 'Expense Type, Date, and Amount are required.', 'warning');
                return;
            }

            await addLineItemApex({
                claimId: this.claimId,
                expenseType: this.liType,
                expenseDate: this.liDate,
                amount: this.liAmount,
                merchant: this.liMerchant,
                description: this.liDesc
            });

            // clear inputs
            this.liType = '';
            this.liDate = '';
            this.liAmount = '';
            this.liMerchant = '';
            this.liDesc = '';

            await this.refreshClaimAndItems();
            this.toast('Added', 'Line item added.', 'success');
        } catch (err) {
            this.toastError(err);
        }
    }

    async handleRowAction(event) {
        const action = event.detail.action.name;
        const row = event.detail.row;
        if (action === 'delete') {
            try {
                await deleteLineItem({ lineItemId: row.Id });
                await this.refreshClaimAndItems();
                this.toast('Deleted', 'Line item deleted.', 'success');
            } catch (err) {
                this.toastError(err);
            }
        }
    }

    handleUploadFinished() {
        this.toast('Uploaded', 'Receipt(s) uploaded.', 'success');
        this.refreshClaimAndItems();
    }

    async submit() {
        try {
            await submitClaimForApproval({ claimId: this.claimId });
            await this.refreshClaimAndItems();

            this.submitted = true;

            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Submitted',
                    message: 'Claim submitted for approval',
                    variant: 'success'
                })
            );

            // Redirect to wizard home (replace with your App Page API name)
            window.location.href = '/lightning/n/Expense_Claim_Wizard';
        } catch (err) {
            this.toastError(err);
        }
    }

    async refreshClaimAndItems() {
        if (!this.claimId) return;

        const c = await getClaim({ claimId: this.claimId });
        this.claimName = c.Name;
        this.claimStatus = c.Status__c;
        this.totalAmount = c.Total_Expense_Amount__c;

        this.lineItems = await getLineItems({ claimId: this.claimId });
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    toastError(err) {
        const msg = err?.body?.message || err?.message || 'Unknown error';
        this.toast('Error', msg, 'error');
    }
}
